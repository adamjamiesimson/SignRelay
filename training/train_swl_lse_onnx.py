"""Train a small browser model from the official SWL-LSE MediaPipe release.

The released ``MEDIAPIPE.zip`` holds the legacy Holistic results for 8,000
real-signer Spanish Sign Language sequences. This script keeps the dataset
separate from the repository: it reads the official files in a temporary
directory, trains a 300-class temporal landmark model, and exports only the
ONNX model, labels and evaluation metadata needed by the browser.
"""

from __future__ import annotations

import argparse
import csv
import json
import pickle
import random
from pathlib import Path

import numpy as np
import torch
from torch import Tensor, nn
from torch.utils.data import DataLoader, Dataset

FRAMES = 64
POSE_INDICES = [0, 2, 5, 7, 8, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24]
POINTS = 61
FEATURES = POINTS * 3


class TemporalLandmarkNet(nn.Module):
    """Compact Conv1D classifier designed for browser ONNX inference."""

    def __init__(self, classes: int = 300) -> None:
        super().__init__()
        self.input = nn.Sequential(nn.Linear(FEATURES, 192), nn.GELU(), nn.LayerNorm(192))
        self.temporal = nn.Sequential(
            nn.Conv1d(192, 256, 5, padding=2), nn.GELU(), nn.BatchNorm1d(256),
            nn.Conv1d(256, 256, 5, padding=2, groups=4), nn.GELU(), nn.BatchNorm1d(256),
            nn.Conv1d(256, 256, 3, padding=1), nn.GELU(),
        )
        self.head = nn.Sequential(nn.Linear(512, 384), nn.GELU(), nn.Dropout(0.18), nn.Linear(384, classes))

    def forward(self, values: Tensor) -> Tensor:
        values = self.input(values).transpose(1, 2)
        values = self.temporal(values)
        return self.head(torch.cat((values.mean(-1), values.amax(-1)), dim=1))


class LandmarkDataset(Dataset[tuple[Tensor, Tensor]]):
    def __init__(self, rows: list[tuple[Path, int]]) -> None:
        self.rows = rows

    def __len__(self) -> int:
        return len(self.rows)

    def __getitem__(self, index: int) -> tuple[Tensor, Tensor]:
        path, label = self.rows[index]
        with path.open("rb") as source:
            result = pickle.load(source)
        return torch.from_numpy(sequence_from_release(result)), torch.tensor(label, dtype=torch.long)


def sequence_from_release(result: object) -> np.ndarray:
    """Convert the authors' saved Holistic output into SignRelay's contract."""
    frames: list[np.ndarray] = []
    for record in result if isinstance(result, list) else []:
        holistic = record.get("holistic_legacy", {}) if isinstance(record, dict) else {}
        pose = landmarks(holistic.get("pose_landmarks"))
        left = landmarks(holistic.get("left_hand_landmarks"))
        right = landmarks(holistic.get("right_hand_landmarks"))
        selected_pose = [pose[index] if index < len(pose) else zeros() for index in POSE_INDICES]
        points = selected_pose + pad(left, 21) + pad(right, 21)
        frames.append(normalise(np.asarray(points, dtype=np.float32)))
    if not frames:
        return np.zeros((FRAMES, FEATURES), dtype=np.float32)
    return resample(np.stack(frames), FRAMES).reshape(FRAMES, FEATURES)


def landmarks(container: object) -> list[list[float]]:
    entries = getattr(container, "landmark", []) if container else []
    return [[float(point.x), float(point.y), float(point.z)] for point in entries]


def zeros() -> list[float]:
    return [0.0, 0.0, 0.0]


def pad(points: list[list[float]], size: int) -> list[list[float]]:
    return (points[:size] + [zeros() for _ in range(size)])[:size]


def normalise(points: np.ndarray) -> np.ndarray:
    left, right = points[5], points[6]
    valid_shoulders = bool(np.any(left) and np.any(right))
    centre = (left + right) / 2 if valid_shoulders else np.asarray([0.5, 0.5, 0.0], dtype=np.float32)
    scale = float(np.linalg.norm(left[:2] - right[:2])) if valid_shoulders else 0.25
    scale = max(scale, 0.08)
    output = (points - centre) / scale
    output[np.all(points == 0, axis=1)] = 0
    return output


def resample(values: np.ndarray, count: int) -> np.ndarray:
    indices = np.rint(np.linspace(0, max(0, len(values) - 1), count)).astype(int)
    return values[indices]


def read_labels(path: Path) -> list[str]:
    with path.open(encoding="utf-8") as source:
        rows = list(csv.DictReader(source))
    by_id = {int(row["CLASS_ID"]): row["LABEL"].strip() for row in rows}
    labels = [by_id[index] for index in range(300)]
    if len(labels) != 300 or any(not label for label in labels):
        raise ValueError("Expected all 300 official SWL-LSE labels")
    return labels


def read_split(path: Path, media_root: Path) -> list[tuple[Path, int]]:
    rows: list[tuple[Path, int]] = []
    lookup = {file.stem: file for file in media_root.rglob("*.pkl")}
    with path.open(encoding="utf-8") as source:
        for row in csv.reader(source):
            if len(row) < 2:
                continue
            sample = lookup.get(row[0])
            if sample:
                rows.append((sample, int(row[1])))
    if not rows:
        raise ValueError(f"No SWL-LSE records matched {path.name}")
    return rows


def accuracy(model: nn.Module, loader: DataLoader[tuple[Tensor, Tensor]], device: torch.device) -> float:
    model.eval()
    correct = total = 0
    with torch.inference_mode():
        for values, labels in loader:
            predictions = model(values.to(device)).argmax(1).cpu()
            correct += int((predictions == labels).sum())
            total += len(labels)
    return correct / max(total, 1)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("media_root", type=Path)
    parser.add_argument("annotations", type=Path)
    parser.add_argument("label_map", type=Path)
    parser.add_argument("--output", type=Path, default=Path("public/models/lse300-swl"))
    parser.add_argument("--epochs", type=int, default=24)
    args = parser.parse_args()

    random.seed(42)
    np.random.seed(42)
    torch.manual_seed(42)
    labels = read_labels(args.label_map)
    train_rows = read_split(args.annotations / "train_labels.csv", args.media_root)
    valid_rows = read_split(args.annotations / "val_labels.csv", args.media_root)
    train_loader = DataLoader(LandmarkDataset(train_rows), batch_size=48, shuffle=True, num_workers=2, persistent_workers=True)
    valid_loader = DataLoader(LandmarkDataset(valid_rows), batch_size=96, num_workers=2, persistent_workers=True)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = TemporalLandmarkNet(len(labels)).to(device)
    optimiser = torch.optim.AdamW(model.parameters(), lr=0.0015, weight_decay=0.0002)
    best = {"accuracy": -1.0, "state": None}

    for epoch in range(args.epochs):
        model.train()
        for values, targets in train_loader:
            optimiser.zero_grad(set_to_none=True)
            loss = nn.functional.cross_entropy(model(values.to(device)), targets.to(device))
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimiser.step()
        score = accuracy(model, valid_loader, device)
        print(f"epoch {epoch + 1}/{args.epochs}: validation accuracy={score:.4f}", flush=True)
        if score > best["accuracy"]:
            best = {"accuracy": score, "state": {key: value.cpu().clone() for key, value in model.state_dict().items()}}

    if best["state"] is None:
        raise RuntimeError("SWL-LSE training produced no checkpoint")
    model.load_state_dict(best["state"])
    model.eval()
    args.output.mkdir(parents=True, exist_ok=True)
    torch.onnx.export(model.cpu(), torch.zeros((1, FRAMES, FEATURES), dtype=torch.float32), args.output / "model.onnx", input_names=["landmarks"], output_names=["logits"], opset_version=17, dynamo=False)
    (args.output / "labels.json").write_text(json.dumps(labels, ensure_ascii=False, indent=2), encoding="utf-8")
    (args.output / "model.json").write_text(json.dumps({
        "format": "onnx", "modelVersion": "swl-lse300-temporal-landmark-v1", "language": "LSE", "classes": 300,
        "sequenceLength": FRAMES, "inputFeatures": FEATURES, "inputName": "landmarks", "outputName": "logits",
        "source": {"dataset": "SWL-LSE / SignaMed", "architecture": "TemporalLandmarkNet", "validationAccuracy": best["accuracy"]},
    }, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
