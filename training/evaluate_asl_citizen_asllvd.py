"""Research-only cross-dataset check for Microsoft's ASL Citizen ST-GCN.

Runs the official checkpoint on local labelled videos using the upstream
MediaPipe Holistic input contract. Raw video and checkpoint stay local.
Outputs metadata-only predictions/ranks.

Requires: torch, numpy, opencv-python-headless, mediapipe.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np
import torch

from export_asl_citizen_stgcn import Network, load_labels


MAX_FRAMES = 128
KEYPOINTS = [
    0, 2, 5, 11, 12, 13, 14,
    33, 37, 38, 41, 42, 45, 46, 49, 50, 53,
    54, 58, 59, 62, 63, 66, 67, 70, 71, 74,
]


def downsample(frames: np.ndarray, max_frames: int = MAX_FRAMES) -> np.ndarray:
    length = frames.shape[0]
    increment = max_frames / length
    if increment > 1.0:
        increment = 1.0
    current_increment = 0.0
    current_frame = 0
    selected = []
    for frame in frames:
        current_increment += increment
        if current_increment > current_frame:
            current_frame += 1
            selected.append(frame)
    if len(selected) > max_frames:
        selected = selected[:max_frames]
    return np.asarray(selected)


def preprocess(raw: np.ndarray) -> np.ndarray:
    if raw.ndim != 3 or raw.shape[1:] != (75, 2):
        raise ValueError(f"Expected [T,75,2], got {raw.shape}")
    length = raw.shape[0]
    if length > MAX_FRAMES:
        raw = downsample(raw, MAX_FRAMES)
    if length < MAX_FRAMES:
        raw = np.pad(raw, ((0, MAX_FRAMES - length), (0, 0), (0, 0)))
    raw = raw[:MAX_FRAMES].astype(np.float64, copy=True)

    shoulder_l = raw[:, 11, :]
    shoulder_r = raw[:, 12, :]
    center = np.mean((shoulder_l + shoulder_r) / 2.0, axis=0)
    mean_dist = np.mean(np.sqrt(((shoulder_l - shoulder_r) ** 2).sum(-1)))
    if mean_dist != 0:
        raw = (raw - center) / mean_dist

    pose = raw[:, :33, :]
    right = raw[:, 33:54, :]
    left = raw[:, 54:75, :]
    reordered = np.concatenate([pose, left, right], axis=1)
    selected = reordered[:, KEYPOINTS, :]
    return np.transpose(selected, (2, 0, 1))


def extract_video(path: Path, holistic) -> tuple[np.ndarray, dict]:
    capture = cv2.VideoCapture(str(path))
    if not capture.isOpened():
        raise RuntimeError(f"Could not open {path}")
    frames = []
    pose_frames = hand_frames = total = 0
    while True:
        ok, bgr = capture.read()
        if not ok:
            break
        total += 1
        result = holistic.process(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB))
        feature = np.zeros((75, 2), dtype=np.float64)
        if result.pose_landmarks:
            pose_frames += 1
            for i in range(33):
                point = result.pose_landmarks.landmark[i]
                feature[i] = (point.x, point.y)
        any_hand = False
        if result.right_hand_landmarks:
            any_hand = True
            for i in range(21):
                point = result.right_hand_landmarks.landmark[i]
                feature[33 + i] = (point.x, point.y)
        if result.left_hand_landmarks:
            any_hand = True
            for i in range(21):
                point = result.left_hand_landmarks.landmark[i]
                feature[54 + i] = (point.x, point.y)
        hand_frames += int(any_hand)
        frames.append(feature)
    capture.release()
    if not frames:
        raise RuntimeError(f"No frames decoded from {path}")
    return np.asarray(frames), {
        "frames": total,
        "pose_coverage": pose_frames / max(total, 1),
        "hand_coverage": hand_frames / max(total, 1),
    }


def read_jsonl(path: Path) -> list[dict]:
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            rows.append(json.loads(line))
    return rows


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("checkpoint", type=Path)
    parser.add_argument("train_csv", type=Path)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--output", type=Path, default=Path("work/asl-citizen-asllvd.json"))
    parser.add_argument("--quiet", action="store_true")
    parser.add_argument("--note", default="Cross-dataset ASLLVD research diagnostic; not an ASL Citizen signer-independent benchmark.")
    args = parser.parse_args()

    labels = load_labels(args.train_csv)
    label_index = {label.upper(): index for index, label in enumerate(labels)}

    original_default = torch.get_default_dtype()
    torch.set_default_dtype(torch.float64)
    try:
        model = Network(len(labels))
    finally:
        torch.set_default_dtype(original_default)
    state = torch.load(args.checkpoint, map_location="cpu", weights_only=True)
    model.load_state_dict(state)
    model.eval()

    rows = read_jsonl(args.manifest)
    records = []
    holistic_module = mp.solutions.holistic
    with holistic_module.Holistic(
        static_image_mode=False,
        min_detection_confidence=0.5,
        min_tracking_confidence=0.5,
    ) as holistic:
        for row in rows:
            if row.get("trial_type") != "sign":
                continue
            expected = str(row.get("expected_gloss") or "").strip().upper()
            expected_index = label_index.get(expected)
            video_path = (args.manifest.parent / row["video"]).resolve()
            raw, tracker = extract_video(video_path, holistic)
            prepared = preprocess(raw)
            tensor = torch.from_numpy(prepared).unsqueeze(0)
            with torch.no_grad():
                logits = model(tensor)
                probabilities = torch.softmax(logits, dim=1)[0]
            order = torch.argsort(probabilities, descending=True)
            top = order[:20].tolist()
            rank = None
            if expected_index is not None:
                match = (order == expected_index).nonzero(as_tuple=False)
                rank = int(match[0, 0].item()) + 1 if len(match) else None
            record = {
                "fixture_id": row.get("id"),
                "expected_gloss": expected,
                "expected_in_vocabulary": expected_index is not None,
                "expected_rank": rank,
                "top1": labels[top[0]],
                "top1_confidence": float(probabilities[top[0]].item()),
                "top5": [labels[i] for i in top[:5]],
                "top20": [labels[i] for i in top],
                "correct_top1": rank == 1,
                "correct_top5": rank is not None and rank <= 5,
                "correct_top20": rank is not None and rank <= 20,
                "tracker": tracker,
            }
            records.append(record)
            if not args.quiet:
                print(
                    f"{record['fixture_id']}: {expected} -> {record['top1']} "
                    f"rank={rank} conf={record['top1_confidence']:.4f} "
                    f"hands={tracker['hand_coverage']:.1%}"
                )

    evaluable = [record for record in records if record["expected_in_vocabulary"]]
    summary = {
        "trials": len(records),
        "vocabulary_overlap": len(evaluable),
        "top1": sum(r["correct_top1"] for r in evaluable) / max(len(evaluable), 1),
        "top5": sum(r["correct_top5"] for r in evaluable) / max(len(evaluable), 1),
        "top20": sum(r["correct_top20"] for r in evaluable) / max(len(evaluable), 1),
        "median_expected_rank": float(np.median([r["expected_rank"] for r in evaluable if r["expected_rank"] is not None])) if evaluable else None,
        "mean_hand_coverage": float(np.mean([r["tracker"]["hand_coverage"] for r in records])) if records else None,
        "note": args.note,
    }
    report = {"summary": summary, "records": records}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
