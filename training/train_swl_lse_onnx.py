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
import hashlib
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
        # Decode the 3.5 GB legacy release once, not on every training epoch.
        values = []
        for index, (path, _) in enumerate(rows):
            with path.open("rb") as source:
                sequence = sequence_from_release(pickle.load(source))
            if not np.isfinite(sequence).all() or not np.any(sequence):
                raise ValueError(f"Empty or non-finite landmark sequence: {path.name}")
            values.append(sequence)
            if (index + 1) % 500 == 0:
                print(f"Decoded {index + 1}/{len(rows)} sequences", flush=True)
        self.values = torch.from_numpy(np.stack(values))
        self.labels = torch.tensor([label for _, label in rows], dtype=torch.long)

    def __len__(self) -> int:
        return len(self.labels)

    def __getitem__(self, index: int) -> tuple[Tensor, Tensor]:
        return self.values[index], self.labels[index]


def sequence_from_release(result: object) -> np.ndarray:
    """Convert the authors' saved Holistic output into SignRelay's contract."""
    if not isinstance(result, list) or not result:
        raise ValueError("Expected a nonempty list of SWL-LSE frame records")
    frames: list[np.ndarray] = []
    for record in result:
        if not isinstance(record, dict) or not isinstance(record.get("holistic_legacy"), dict):
            raise ValueError("SWL-LSE frame is missing its holistic_legacy record")
        holistic = record["holistic_legacy"]
        pose = landmarks(holistic.get("pose_landmarks"))
        left = landmarks(holistic.get("left_hand_landmarks"))
        right = landmarks(holistic.get("right_hand_landmarks"))
        selected_pose = [pose[index] if index < len(pose) else zeros() for index in POSE_INDICES]
        points = selected_pose + pad(left, 21) + pad(right, 21)
        frames.append(normalise(np.asarray(points, dtype=np.float32)))
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
    # Match JavaScript Math.round for nonnegative frame positions.
    indices = np.floor(np.linspace(0, max(0, len(values) - 1), count) + 0.5).astype(int)
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
    lookup = {}
    for file in media_root.rglob("*.pkl"):
        if file.stem in lookup:
            raise ValueError(f"Duplicate SWL-LSE file ID: {file.stem}")
        lookup[file.stem] = file
    with path.open(encoding="utf-8") as source:
        for row in csv.reader(source):
            if not row or row[0].strip().upper() == "FILENAME":
                continue
            if len(row) != 2:
                raise ValueError(f"Invalid split row in {path.name}: {row}")
            sample = lookup.get(Path(row[0].strip()).stem)
            label = int(row[1])
            if sample is None or not 0 <= label < 300:
                raise ValueError(f"Missing sample or invalid class in {path.name}: {row}")
            rows.append((sample, label))
    if not rows:
        raise ValueError(f"No SWL-LSE records matched {path.name}")
    return rows


def validate_splits(train: list, valid: list, test: list) -> None:
    groups = [{path.resolve() for path, _ in rows} for rows in (train, valid, test)]
    if any(len(group) != len(rows) for group, rows in zip(groups, (train, valid, test))):
        raise ValueError("Duplicate samples within an SWL-LSE split")
    if groups[0] & groups[1] or groups[0] & groups[2] or groups[1] & groups[2]:
        raise ValueError("SWL-LSE train/validation/test splits overlap")
    if {label for _, label in train} != set(range(300)):
        raise ValueError("Training split must cover all 300 classes")


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
    parser.add_argument("--min-validation-accuracy", type=float, default=0.5)
    args = parser.parse_args()

    random.seed(42)
    np.random.seed(42)
    torch.manual_seed(42)
    labels = read_labels(args.label_map)
    train_rows = read_split(args.annotations / "train_labels.csv", args.media_root)
    valid_rows = read_split(args.annotations / "val_labels.csv", args.media_root)
    test_rows = read_split(args.annotations / "test_labels.csv", args.media_root)
    validate_splits(train_rows, valid_rows, test_rows)
    torch.set_num_threads(2)
    train_loader = DataLoader(LandmarkDataset(train_rows), batch_size=48, shuffle=True)
    valid_loader = DataLoader(LandmarkDataset(valid_rows), batch_size=96)
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
    if best["accuracy"] < args.min_validation_accuracy:
        raise RuntimeError(f"Validation accuracy {best['accuracy']:.4f} is below the research install gate")
    # The test split is evaluated once, after validation-based model selection.
    test_score = accuracy(model, DataLoader(LandmarkDataset(test_rows), batch_size=96), device)
    args.output.mkdir(parents=True, exist_ok=True)
    torch.onnx.export(model.cpu(), torch.zeros((1, FRAMES, FEATURES), dtype=torch.float32), args.output / "model.onnx", input_names=["landmarks"], output_names=["logits"], opset_version=17, dynamo=False)
    import onnxruntime as ort
    session = ort.InferenceSession(str(args.output / "model.onnx"), providers=["CPUExecutionProvider"])
    sample = next(iter(valid_loader))[0][:1]
    with torch.inference_mode():
        expected = model(sample).numpy()
    actual = session.run(["logits"], {"landmarks": sample.numpy()})[0]
    if actual.shape != (1, 300) or not np.isfinite(actual).all():
        raise RuntimeError("Invalid exported ONNX output")
    np.testing.assert_allclose(actual, expected, rtol=1e-3, atol=1e-4)
    (args.output / "labels.json").write_text(json.dumps(labels, ensure_ascii=False, indent=2), encoding="utf-8")
    (args.output / "model.json").write_text(json.dumps({
        "format": "onnx", "modelVersion": "swl-lse300-temporal-landmark-v1", "language": "LSE", "classes": 300,
        "sequenceLength": FRAMES, "inputFeatures": FEATURES, "inputName": "landmarks", "outputName": "logits",
        "sha256": hashlib.sha256((args.output / "model.onnx").read_bytes()).hexdigest(),
        "exportVerified": True,
        "source": {"dataset": "SWL-LSE / SignaMed", "url": "https://zenodo.org/records/13691887", "architecture": "TemporalLandmarkNet", "validationAccuracy": best["accuracy"], "testAccuracy": test_score,
                   "splitCounts": {"train": len(train_rows), "validation": len(valid_rows), "test": len(test_rows)},
                   "liveCameraAccuracy": None},
    }, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
