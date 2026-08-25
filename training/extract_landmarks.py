"""Extract ordered holistic landmark features from audited sign videos.

Run after pipeline.py has created a signer-independent split manifest. Model
asset paths are explicit so a training run can record exact file hashes.
"""

from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np


FEATURES_PER_FRAME = (21 * 3 * 2) + (20 * 3) + (17 * 4)
FACE_CUES = [0, 4, 10, 13, 14, 17, 33, 61, 70, 105, 133, 145, 159, 263, 291, 300, 334, 362, 374, 386]
POSE_CUES = list(range(17))


def zeros(count: int, dimensions: int) -> list[float]:
    return [0.0] * (count * dimensions)


def flatten(points, indices: list[int] | None = None, include_visibility: bool = False) -> list[float]:
    if not points:
        count = len(indices) if indices is not None else 21
        return zeros(count, 4 if include_visibility else 3)
    chosen = [points[index] for index in indices] if indices is not None else points
    values: list[float] = []
    for point in chosen:
        values.extend([point.x, point.y, point.z])
        if include_visibility:
            values.append(getattr(point, "visibility", 1.0))
    return values


def extract_video(video_path: Path, hand, face, pose, sample_fps: float) -> tuple[np.ndarray, np.ndarray]:
    capture = cv2.VideoCapture(str(video_path))
    source_fps = capture.get(cv2.CAP_PROP_FPS) or 30.0
    stride = max(1, round(source_fps / sample_fps))
    frames, mask = [], []
    frame_index = 0
    while True:
        ok, bgr = capture.read()
        if not ok:
            break
        if frame_index % stride:
            frame_index += 1
            continue
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        timestamp = int(capture.get(cv2.CAP_PROP_POS_MSEC))
        hand_result = hand.detect_for_video(image, timestamp)
        face_result = face.detect_for_video(image, timestamp)
        pose_result = pose.detect_for_video(image, timestamp)

        hands_by_side = {"Left": None, "Right": None}
        for landmarks, handedness in zip(hand_result.hand_landmarks, hand_result.handedness):
            hands_by_side[handedness[0].category_name] = landmarks
        feature = (
            flatten(hands_by_side["Left"])
            + flatten(hands_by_side["Right"])
            + flatten(face_result.face_landmarks[0] if face_result.face_landmarks else None, FACE_CUES)
            + flatten(pose_result.pose_landmarks[0] if pose_result.pose_landmarks else None, POSE_CUES, True)
        )
        if len(feature) != FEATURES_PER_FRAME:
            raise RuntimeError(f"Feature contract mismatch: {len(feature)} != {FEATURES_PER_FRAME}")
        frames.append(feature)
        mask.append(1.0)
        frame_index += 1
    capture.release()
    return np.asarray(frames, dtype=np.float32), np.asarray(mask, dtype=np.float32)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--hand-model", type=Path, required=True)
    parser.add_argument("--face-model", type=Path, required=True)
    parser.add_argument("--pose-model", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=Path("artifacts/features"))
    parser.add_argument("--sample-fps", type=float, default=12.0)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)

    base = mp.tasks.BaseOptions
    mode = mp.tasks.vision.RunningMode.VIDEO
    hand = mp.tasks.vision.HandLandmarker.create_from_options(mp.tasks.vision.HandLandmarkerOptions(base_options=base(model_asset_path=str(args.hand_model)), running_mode=mode, num_hands=2))
    face = mp.tasks.vision.FaceLandmarker.create_from_options(mp.tasks.vision.FaceLandmarkerOptions(base_options=base(model_asset_path=str(args.face_model)), running_mode=mode, num_faces=1))
    pose = mp.tasks.vision.PoseLandmarker.create_from_options(mp.tasks.vision.PoseLandmarkerOptions(base_options=base(model_asset_path=str(args.pose_model)), running_mode=mode, num_poses=1))

    index = []
    with args.manifest.open(newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            features, mask = extract_video(args.manifest.parent / row["video_path"], hand, face, pose, args.sample_fps)
            output = args.output / f"{row['sample_id']}.npz"
            np.savez_compressed(output, features=features, mask=mask)
            index.append({**row, "feature_path": str(output), "frames": len(features)})

    hand.close(); face.close(); pose.close()
    (args.output / "index.json").write_text(json.dumps(index, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
