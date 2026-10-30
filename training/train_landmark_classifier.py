"""Train a signer-independent ASL sign classifier on SignRelay's own landmarks.

Replacement candidate for the WLASL2000 Pose-TGCN (Sprint 8). Trained on
PopSign ASL v1.0 (CC BY 4.0) clips processed by the browser's MediaPipe Tasks
models (training/popsign_landmarks.py), so training and live input share one
representation.

Rejection: a deterministic set of PopSign signs is held out as an "other"
class (real ASL movements that are not in the vocabulary), and a second,
disjoint set is never seen in training at all; the second set measures how
often unsupported movements are accepted as words.

Evaluation is signer-independent by construction: model selection uses the
publisher's validation split, results use the publisher's test split, and any
signer overlap between splits is reported (and those clips are excluded).

Features per frame (mirrored exactly by lib/landmark-sign-features.ts):
  body frame: centre = shoulder midpoint, scale = shoulder width;
  each hand slot (MediaPipe label Left, Right): 21 points relative to the body
  frame, 21 points relative to the wrist / palm size, and a presence flag;
  upper body: nose, elbows, wrists relative to the body frame.
The hand-present span is resampled to SEQUENCE frames.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import random
import re
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np

SEQUENCE = 32
POSE_POINTS = [0, 13, 14, 15, 16]
FEATURES = 2 * (42 + 42 + 1) + len(POSE_POINTS) * 2
SEED = 20261030
TARGET_PRECISION = 0.9


# ---------------------------------------------------------------- features

def body_frame(pose: np.ndarray) -> tuple[np.ndarray, float] | None:
    left, right = pose[11], pose[12]
    if np.isnan(left[:2]).any() or np.isnan(right[:2]).any() or left[2] < 0.4 or right[2] < 0.4:
        return None
    scale = float(np.hypot(*(left[:2] - right[:2])))
    return (left[:2] + right[:2]) / 2, max(scale, 0.05)


def clip_features(pose: np.ndarray, hands: np.ndarray, mirror: bool = False) -> np.ndarray | None:
    """pose (T, 33, 3), hands (T, 2, 21, 2) -> (SEQUENCE, FEATURES) or None."""
    pose = pose.astype(np.float32).copy()
    hands = hands.astype(np.float32).copy()
    if mirror:
        pose[..., 0] = 1 - pose[..., 0]
        pose[:, [11, 12, 13, 14, 15, 16]] = pose[:, [12, 11, 14, 13, 16, 15]]
        hands[..., 0] = 1 - hands[..., 0]
        hands = hands[:, ::-1]
    present = ~np.isnan(hands[:, :, 0, 0]).all(axis=1)
    if present.sum() < 4:
        return None
    first, last = int(np.argmax(present)), len(present) - 1 - int(np.argmax(present[::-1]))
    frames = []
    reference = None
    for t in range(len(pose)):
        candidate = body_frame(pose[t])
        if candidate is not None:
            reference = candidate
        frames.append(reference)
    fallback = next((r for r in frames if r is not None), None)
    if fallback is None:
        return None
    indices = np.round(np.linspace(first, last, SEQUENCE)).astype(int)
    out = np.zeros((SEQUENCE, FEATURES), dtype=np.float32)
    for row, t in enumerate(indices):
        centre, scale = frames[t] if frames[t] is not None else fallback
        values = []
        for slot in range(2):
            points = hands[t, slot]
            if np.isnan(points[0, 0]):
                values.extend([0.0] * 85)
                continue
            body = (points - centre) / scale
            palm = max(float(np.hypot(*(points[9] - points[0]))), float(np.hypot(*(points[17] - points[5]))), 1e-3)
            local = (points - points[0]) / palm
            values.extend(body.reshape(-1).tolist() + local.reshape(-1).tolist() + [1.0])
        for index in POSE_POINTS:
            point = pose[t, index]
            values.extend(((point[:2] - centre) / scale).tolist() if not np.isnan(point[0]) and point[2] >= 0.3 else [0.0, 0.0])
        out[row] = np.nan_to_num(np.asarray(values, dtype=np.float32), nan=0.0, posinf=0.0, neginf=0.0)
    return np.clip(out, -8, 8)


# ---------------------------------------------------------------- data

def load(directory: Path, split: str) -> list[dict]:
    clips = []
    for path in sorted(directory.glob(f"{split}-*.npz")):
        data = np.load(path)
        pose, hands = data["pose"], data["hands"]
        for entry in json.loads(str(data["index"])):
            span = slice(entry["offset"], entry["offset"] + entry["frames"])
            clips.append({**entry, "pose": pose[span], "hands": hands[span]})
    return clips


def vocabulary(signs: list[str]) -> tuple[list[str], set[str], set[str]]:
    """Deterministic: 12 signs train an 'other' class, 25 others are never seen."""
    ordered = sorted(signs, key=lambda sign: hashlib.sha256(f"{SEED}:{sign}".encode()).hexdigest())
    unseen, other = set(ordered[:25]), set(ordered[25:37])
    return sorted(set(signs) - unseen - other), other, unseen


# ---------------------------------------------------------------- model

def build_model(classes: int):
    import torch
    from torch import nn

    class Block(nn.Module):
        def __init__(self, channels: int, dilation: int) -> None:
            super().__init__()
            self.conv = nn.Conv1d(channels, channels, 5, padding=2 * dilation, dilation=dilation)
            self.norm = nn.BatchNorm1d(channels)
            self.drop = nn.Dropout(0.2)

        def forward(self, x):
            return x + self.drop(torch.nn.functional.gelu(self.norm(self.conv(x))))

    class Classifier(nn.Module):
        def __init__(self) -> None:
            super().__init__()
            self.stem = nn.Sequential(nn.Conv1d(FEATURES, 192, 1), nn.BatchNorm1d(192), nn.GELU())
            self.blocks = nn.Sequential(*[Block(192, d) for d in (1, 2, 4, 1, 2, 4)])
            self.head = nn.Sequential(nn.Dropout(0.3), nn.Linear(384, classes))

        def forward(self, x):  # x: (batch, SEQUENCE, FEATURES)
            h = self.blocks(self.stem(x.transpose(1, 2)))
            return self.head(torch.cat([h.mean(dim=2), h.amax(dim=2)], dim=1))

    return Classifier()


def augment(pose: np.ndarray, hands: np.ndarray, rng: random.Random) -> tuple[np.ndarray, np.ndarray]:
    pose, hands = pose.astype(np.float32).copy(), hands.astype(np.float32).copy()
    length = len(pose)
    speed = rng.uniform(0.75, 1.3)
    picks = np.clip(np.round(np.arange(0, length, speed)).astype(int), 0, length - 1)
    pose, hands = pose[picks], hands[picks]
    # Live pose refreshes at most every 150 ms; hold it like the browser does.
    if rng.random() < 0.5:
        for t in range(len(pose)):
            if t % 4:
                pose[t] = pose[t - t % 4]
    # Missed hand detections during fast movement.
    for t in range(len(hands)):
        if rng.random() < 0.08:
            hands[t, rng.randrange(2)] = np.nan
    scale, dx, dy = rng.uniform(0.85, 1.15), rng.uniform(-0.08, 0.08), rng.uniform(-0.08, 0.08)
    for array in (pose[..., :2], hands):
        array[..., 0] = (array[..., 0] - 0.5) * scale + 0.5 + dx
        array[..., 1] = (array[..., 1] - 0.5) * scale * rng.uniform(0.95, 1.05) + 0.5 + dy
    return pose, hands


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("landmarks", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--epochs", type=int, default=60)
    parser.add_argument("--wlasl-labels", type=Path, default=Path("public/models/asl2000-tgcn/labels.json"))
    args = parser.parse_args()
    import torch

    torch.manual_seed(SEED)
    rng = random.Random(SEED)
    train, val, test = load(args.landmarks, "train"), load(args.landmarks, "val"), load(args.landmarks, "test")
    signers = {split: {c["signer"] for c in clips} for split, clips in (("train", train), ("val", val), ("test", test))}
    overlap = (signers["train"] & signers["test"]) | (signers["val"] & signers["test"])
    test = [c for c in test if c["signer"] not in overlap]
    val = [c for c in val if c["signer"] not in signers["train"]]
    if not val:
        # No usable validation split: hold out a deterministic 15% of training
        # signers for model selection, so selection never sees test signers.
        ordered = sorted(signers["train"], key=lambda signer: hashlib.sha256(f"{SEED}:{signer}".encode()).hexdigest())
        held = set(ordered[:max(1, len(ordered) * 15 // 100)])
        val = [c for c in train if c["signer"] in held]
        train = [c for c in train if c["signer"] not in held]
    words, other, unseen = vocabulary(sorted({c["sign"] for c in train}))
    labels = words + ["__other__"]
    class_of = {sign: i for i, sign in enumerate(words)}
    other_class = len(words)

    def target(sign: str) -> int | None:
        return class_of.get(sign, other_class if sign in other else None)

    def tensors(clips: list[dict], augmented: bool, copies: int = 1):
        xs, ys = [], []
        for clip in clips:
            y = target(clip["sign"])
            if y is None:
                continue
            for _ in range(copies):
                pose, hands = augment(clip["pose"], clip["hands"], rng) if augmented else (clip["pose"], clip["hands"])
                x = clip_features(pose, hands, mirror=augmented and rng.random() < 0.3)
                if x is not None:
                    xs.append(x); ys.append(y)
        return torch.tensor(np.asarray(xs)), torch.tensor(ys)

    model = build_model(len(labels))
    optimiser = torch.optim.AdamW(model.parameters(), lr=2e-3, weight_decay=0.05)
    schedule = torch.optim.lr_scheduler.OneCycleLR(optimiser, max_lr=2e-3, total_steps=args.epochs * 64)
    loss_fn = torch.nn.CrossEntropyLoss(label_smoothing=0.1)
    val_x, val_y = tensors(val, False)
    best, best_state = -1.0, None
    for epoch in range(args.epochs):
        x, y = tensors(train, True)
        model.train()
        order = torch.randperm(len(x))
        batches = torch.chunk(order, 64)
        for batch in batches:
            optimiser.zero_grad()
            loss = loss_fn(model(x[batch]), y[batch])
            loss.backward()
            optimiser.step()
            schedule.step()
        model.eval()
        with torch.no_grad():
            accuracy = float((model(val_x).argmax(1) == val_y).float().mean()) if len(val_x) else 0.0
        if accuracy > best:
            best, best_state = accuracy, {k: v.clone() for k, v in model.state_dict().items()}
        print(json.dumps({"epoch": epoch, "loss": round(float(loss), 4), "val_top1": round(accuracy, 4)}), flush=True)
    model.load_state_dict(best_state)
    model.eval()

    # ---------------------------------------------------------- evaluation
    def predict(clips: list[dict]):
        rows = []
        with torch.no_grad():
            for clip in clips:
                x = clip_features(clip["pose"], clip["hands"])
                if x is None:
                    rows.append({**{k: clip[k] for k in ("sign", "signer", "member")}, "tracked": False})
                    continue
                probabilities = torch.softmax(model(torch.tensor(x[None])), dim=1)[0].numpy()
                order = np.argsort(-probabilities)
                rows.append({**{k: clip[k] for k in ("sign", "signer", "member")}, "tracked": True,
                             "prediction": labels[order[0]], "confidence": float(probabilities[order[0]]),
                             "margin": float(probabilities[order[0]] - probabilities[order[1]]),
                             "top5": [labels[i] for i in order[:5]]})
        return rows

    test_rows = predict(test)
    known = [r for r in test_rows if r["sign"] in class_of]
    rejected_known = [r for r in test_rows if r["sign"] in other]
    never_seen = [r for r in test_rows if r["sign"] in unseen]

    def gate(r: dict, confidence: float) -> bool:
        return r["tracked"] and r["prediction"] != "__other__" and r["confidence"] >= confidence

    # The operating threshold is chosen on validation signers only: the lowest
    # confidence whose accepted predictions are at least TARGET_PRECISION correct,
    # counting accepted 'other' and never-seen-sign clips as errors.
    val_rows = predict(val)
    threshold = 0.99
    for candidate in [round(0.3 + 0.02 * i, 2) for i in range(35)]:
        accepted = [r for r in val_rows if gate(r, candidate)]
        if len(accepted) >= 20 and sum(r["prediction"] == r["sign"] for r in accepted) / len(accepted) >= TARGET_PRECISION:
            threshold = candidate
            break
    accepted = [r for r in known if gate(r, threshold)]
    operating = {"threshold_from_validation_signers": threshold, "target_precision": TARGET_PRECISION,
                 "test_known_clips": len(known), "accepted": len(accepted),
                 "correct": sum(r["prediction"] == r["sign"] for r in accepted),
                 "wrong": sum(r["prediction"] != r["sign"] for r in accepted),
                 "other_class_clips_accepted": sum(gate(r, threshold) for r in rejected_known),
                 "never_seen_sign_clips_accepted": sum(gate(r, threshold) for r in never_seen),
                 "never_seen_sign_clips": len(never_seen)}

    sweep = []
    for confidence in (0.3, 0.5, 0.6, 0.7, 0.8, 0.9):
        accepted = [r for r in known if gate(r, confidence)]
        correct = sum(r["prediction"] == r["sign"] for r in accepted)
        sweep.append({"confidence": confidence, "accepted": len(accepted), "correct": correct,
                      "precision": round(correct / len(accepted), 4) if accepted else None,
                      "recall": round(correct / max(1, len(known)), 4),
                      "unseen_signs_accepted": sum(gate(r, confidence) for r in never_seen),
                      "unseen_sign_false_positive_rate": round(sum(gate(r, confidence) for r in never_seen) / max(1, len(never_seen)), 4)})
    per_sign = defaultdict(lambda: {"clips": 0, "top1": 0, "signers": set()})
    for r in known:
        entry = per_sign[r["sign"]]
        entry["clips"] += 1; entry["signers"].add(r["signer"])
        entry["top1"] += int(r.get("prediction") == r["sign"])
    wlasl = {re.sub(r"[^a-z0-9]", "", label.lower()): label for label in json.loads(args.wlasl_labels.read_text(encoding="utf-8"))}
    report = {
        "dataset": "PopSign ASL v1.0 game split (CC BY 4.0)",
        "signers": {split: len(s) for split, s in signers.items()}, "excluded_overlapping_test_signers": sorted(overlap),
        "classes": len(words), "other_class_signs": sorted(other), "never_seen_signs": sorted(unseen),
        "train_clips": len(train), "val_clips": len(val), "test_clips": len(test), "best_val_top1": best,
        "test": {"known_clips": len(known), "tracked": sum(r["tracked"] for r in known),
                 "top1": round(sum(r.get("prediction") == r["sign"] for r in known) / max(1, len(known)), 4),
                 "top5": round(sum(r["sign"] in r.get("top5", []) for r in known) / max(1, len(known)), 4),
                 "other_class_clips": len(rejected_known), "never_seen_clips": len(never_seen)},
        "gate_sweep": sweep,
        "operating_point": operating,
        "per_sign": {sign: {"clips": v["clips"], "top1": v["top1"], "signers": len(v["signers"]),
                            "wlasl_label": wlasl.get(re.sub(r"[^a-z0-9]", "", sign.lower()))}
                     for sign, v in sorted(per_sign.items())},
    }
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / "report.json").write_text(json.dumps(report, indent=1) + "\n", encoding="utf-8")
    (args.output / "labels.json").write_text(json.dumps(labels, indent=1) + "\n", encoding="utf-8")
    (args.output / "metadata.json").write_text(json.dumps({
        "model": "signrelay-popsign-landmark-candidate", "sequence": SEQUENCE, "features": FEATURES,
        "classes": len(labels), "rejectLabel": "__other__", "threshold": threshold,
        "dataset": "PopSign ASL v1.0 game split, CC BY 4.0 (Georgia Tech / Deaf Professional Arts Network)",
        "featureSpec": "lib/landmark-sign-features.ts = training/train_landmark_classifier.py clip_features"}, indent=1) + "\n", encoding="utf-8")
    with (args.output / "test-predictions.jsonl").open("w", encoding="utf-8") as handle:
        for row in test_rows:
            handle.write(json.dumps(row) + "\n")
    torch.onnx.export(model, torch.zeros(1, SEQUENCE, FEATURES), args.output / "model.onnx", input_names=["features"],
                      output_names=["logits"], dynamic_axes={"features": {0: "batch"}, "logits": {0: "batch"}}, opset_version=17)
    print(json.dumps({k: v for k, v in report.items() if k not in ("per_sign",)}, indent=1))


if __name__ == "__main__":
    main()
