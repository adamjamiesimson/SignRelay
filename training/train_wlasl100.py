"""Train a compact, browser-readable WLASL100 landmark classifier.

The input CSVs are the CC-BY-NC WLASL100 supplementary landmarks published with
SPOTER.  Raw clips are deliberately never copied into this repository.  The
export is a quantised two-layer MLP stored as JSON, so the app can run it in a
Web Worker without a cloud inference API.
"""

from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

import numpy as np
from sklearn.metrics import accuracy_score, top_k_accuracy_score
from sklearn.neural_network import MLPClassifier


BODY = ["nose", "neck", "rightEye", "leftEye", "rightEar", "leftEar", "rightShoulder", "leftShoulder", "rightElbow", "leftElbow", "rightWrist", "leftWrist"]
HAND = ["wrist", "indexTip", "indexDIP", "indexPIP", "indexMCP", "middleTip", "middleDIP", "middlePIP", "middleMCP", "ringTip", "ringDIP", "ringPIP", "ringMCP", "littleTip", "littleDIP", "littlePIP", "littleMCP", "thumbTip", "thumbIP", "thumbMP", "thumbCMC"]
POINTS = BODY + [f"{point}_{side}" for side in ("left", "right") for point in HAND]


def parse_sequence(row: dict[str, str], length: int) -> np.ndarray:
    coords = []
    for point in POINTS:
        xs = np.fromstring(row[f"{point}_X"][1:-1], sep=",", dtype=np.float32)
        ys = np.fromstring(row[f"{point}_Y"][1:-1], sep=",", dtype=np.float32)
        coords.append(np.stack((xs, ys), axis=1))
    frames = np.stack(coords, axis=1).astype(np.float32)
    # The released sequences use a body crop plus independent hand crops.
    # Reproduce that geometry here so the model learns movements rather than
    # camera distance, and mirror it exactly in the browser adapter.
    last_box = None
    for i, frame in enumerate(frames):
        left_shoulder, right_shoulder, neck, left_eye = frame[7], frame[6], frame[1], frame[3]
        shoulder_ok = left_shoulder[0] != 0 and right_shoulder[0] != 0
        neck_ok = neck[0] != 0 and frame[0, 0] != 0
        if shoulder_ok:
            metric = float(np.linalg.norm(left_shoulder - right_shoulder))
        elif neck_ok:
            metric = float(np.linalg.norm(neck - frame[0]))
        else:
            metric = 0
        if metric > 1e-5:
            start = np.array([neck[0] - 3 * metric, left_eye[1] + metric])
            end = np.array([neck[0] + 3 * metric, start[1] - 6 * metric])
            last_box = (start, end)
        if last_box is not None:
            start, end = last_box
            width, height = end[0] - start[0], start[1] - end[1]
            valid = frame[:12, 0] != 0
            frame[:12][valid, 0] = (frame[:12][valid, 0] - start[0]) / width
            frame[:12][valid, 1] = (frame[:12][valid, 1] - end[1]) / height
        for hand_start in (12, 33):
            hand = frame[hand_start:hand_start + 21]
            valid = hand[:, 0] != 0
            if not valid.any():
                continue
            min_xy, max_xy = hand[valid].min(0), hand[valid].max(0)
            size = max_xy - min_xy
            if size[0] > size[1]:
                dx = 0.1 * size[0]; dy = dx + (size[0] - size[1]) / 2
            else:
                dy = 0.1 * size[1]; dx = dy + (size[1] - size[0]) / 2
            start, end = min_xy - [dx, dy], max_xy + [dx, dy]
            span = end - start
            if span[0] > 1e-6 and span[1] > 1e-6:
                hand[valid] = (hand[valid] - start) / span
    frames -= 0.5
    frames[~np.isfinite(frames)] = 0
    frames = np.clip(frames, -4, 4)
    indices = np.linspace(0, len(frames) - 1, length).round().astype(int)
    return frames[indices].reshape(-1)


def load_csv(path: Path, length: int) -> tuple[np.ndarray, np.ndarray]:
    features, labels = [], []
    with path.open(newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            features.append(parse_sequence(row, length))
            labels.append(int(row["labels"]))
    return np.asarray(features, dtype=np.float32), np.asarray(labels, dtype=np.int64)


def quantise(values: np.ndarray) -> dict:
    max_abs = float(np.max(np.abs(values))) or 1.0
    scale = max_abs / 127.0
    return {"scale": scale, "data": np.rint(values / scale).clip(-127, 127).astype(np.int8).reshape(-1).tolist()}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("dataset", type=Path)
    parser.add_argument("--output", type=Path, default=Path("public/models/asl100"))
    parser.add_argument("--sequence-length", type=int, default=24)
    parser.add_argument("--iterations", type=int, default=280)
    args = parser.parse_args()

    args.output.mkdir(parents=True, exist_ok=True)
    train_x, train_y = load_csv(args.dataset / "WLASL100_train_25fps.csv", args.sequence_length)
    val_x, val_y = load_csv(args.dataset / "WLASL100_val_25fps.csv", args.sequence_length)
    test_x, test_y = load_csv(args.dataset / "WLASL100_test_25fps.csv", args.sequence_length)
    mean, std = train_x.mean(0), train_x.std(0).clip(1e-4)
    train_x, val_x, test_x = (train_x - mean) / std, (val_x - mean) / std, (test_x - mean) / std
    model = MLPClassifier(hidden_layer_sizes=(192,), alpha=4e-4, learning_rate_init=6e-4, batch_size=48, max_iter=args.iterations, early_stopping=True, validation_fraction=0.12, n_iter_no_change=24, random_state=42, verbose=True)
    model.fit(train_x, train_y)
    probabilities = model.predict_proba(test_x)
    metrics = {"top_1_accuracy": float(accuracy_score(test_y, probabilities.argmax(1))), "top_5_accuracy": float(top_k_accuracy_score(test_y, probabilities, k=5, labels=list(range(100)))), "validation_top_1_accuracy": float(accuracy_score(val_y, model.predict(val_x))), "train_top_1_accuracy": float(accuracy_score(train_y, model.predict(train_x))), "iterations_completed": int(model.n_iter_), "train_samples": int(len(train_y)), "validation_samples": int(len(val_y)), "test_samples": int(len(test_y)), "sequence_length": args.sequence_length, "feature_size": int(train_x.shape[1])}
    (args.output / "metrics.json").write_text(json.dumps(metrics, indent=2), encoding="utf-8")
    export = {"format": "signrelay-quantised-mlp-v1", "sequenceLength": args.sequence_length, "points": POINTS, "mean": mean.tolist(), "std": std.tolist(), "layers": [{"input": int(model.coefs_[0].shape[0]), "output": int(model.coefs_[0].shape[1]), "weights": quantise(model.coefs_[0].T), "bias": model.intercepts_[0].tolist(), "activation": "relu"}, {"input": int(model.coefs_[1].shape[0]), "output": int(model.coefs_[1].shape[1]), "weights": quantise(model.coefs_[1].T), "bias": model.intercepts_[1].tolist(), "activation": "softmax"}]}
    (args.output / "model.json").write_text(json.dumps(export, separators=(",", ":")), encoding="utf-8")
    print(json.dumps(metrics, indent=2))


if __name__ == "__main__":
    main()
