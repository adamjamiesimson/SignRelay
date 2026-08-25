"""Train, evaluate and export a compact signer-independent GRU baseline."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import torch
from sklearn.metrics import classification_report, confusion_matrix, top_k_accuracy_score
from torch import nn
from torch.utils.data import DataLoader, Dataset


class SequenceDataset(Dataset):
    def __init__(self, rows: list[dict], vocabulary: dict[str, int], length: int):
        self.rows, self.vocabulary, self.length = rows, vocabulary, length

    def __len__(self): return len(self.rows)

    def __getitem__(self, index):
        row = self.rows[index]
        features = np.load(row["feature_path"])["features"]
        if len(features) >= self.length:
            indices = np.linspace(0, len(features) - 1, self.length).astype(int)
            features = features[indices]
            mask = np.ones(self.length, dtype=np.float32)
        else:
            mask = np.pad(np.ones(len(features), dtype=np.float32), (0, self.length - len(features)))
            features = np.pad(features, ((0, self.length - len(features)), (0, 0)))
        return torch.tensor(features), torch.tensor(mask), torch.tensor(self.vocabulary[row["gloss"]])


class SignGRU(nn.Module):
    def __init__(self, feature_size: int, classes: int, hidden: int = 192):
        super().__init__()
        self.normalise = nn.LayerNorm(feature_size)
        self.gru = nn.GRU(feature_size, hidden, num_layers=2, batch_first=True, dropout=0.2, bidirectional=True)
        self.head = nn.Sequential(nn.LayerNorm(hidden * 2), nn.Dropout(0.25), nn.Linear(hidden * 2, classes))

    def forward(self, features, mask):
        output, _ = self.gru(self.normalise(features))
        weights = mask.unsqueeze(-1)
        pooled = (output * weights).sum(1) / weights.sum(1).clamp_min(1)
        return self.head(pooled)


def evaluate(model, loader, device):
    model.eval(); logits, targets = [], []
    with torch.no_grad():
        for features, mask, labels in loader:
            logits.append(model(features.to(device), mask.to(device)).cpu())
            targets.append(labels)
    return torch.cat(logits).numpy(), torch.cat(targets).numpy()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("index", type=Path)
    parser.add_argument("--output", type=Path, default=Path("artifacts/model"))
    parser.add_argument("--sequence-length", type=int, default=48)
    parser.add_argument("--epochs", type=int, default=35)
    parser.add_argument("--batch-size", type=int, default=32)
    args = parser.parse_args(); args.output.mkdir(parents=True, exist_ok=True)

    torch.manual_seed(42); np.random.seed(42)
    rows = json.loads(args.index.read_text(encoding="utf-8"))
    glosses = sorted({row["gloss"] for row in rows})
    vocabulary = {gloss: index for index, gloss in enumerate(glosses)}
    datasets = {split: SequenceDataset([row for row in rows if row["split"] == split], vocabulary, args.sequence_length) for split in ["train", "validation", "test"]}
    loaders = {split: DataLoader(dataset, batch_size=args.batch_size, shuffle=split == "train") for split, dataset in datasets.items()}
    sample, _, _ = datasets["train"][0]
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = SignGRU(sample.shape[-1], len(glosses)).to(device)
    optimiser = torch.optim.AdamW(model.parameters(), lr=2e-4, weight_decay=1e-3)
    loss_fn = nn.CrossEntropyLoss()
    best_state, best_loss = None, float("inf")

    for _ in range(args.epochs):
        model.train()
        for features, mask, labels in loaders["train"]:
            optimiser.zero_grad()
            loss = loss_fn(model(features.to(device), mask.to(device)), labels.to(device))
            loss.backward(); nn.utils.clip_grad_norm_(model.parameters(), 1.0); optimiser.step()
        validation_logits, validation_targets = evaluate(model, loaders["validation"], device)
        validation_loss = loss_fn(torch.tensor(validation_logits), torch.tensor(validation_targets)).item()
        if validation_loss < best_loss:
            best_loss = validation_loss
            best_state = {key: value.cpu() for key, value in model.state_dict().items()}

    model.load_state_dict(best_state); model.to(device)
    test_logits, test_targets = evaluate(model, loaders["test"], device)
    probabilities = torch.softmax(torch.tensor(test_logits), dim=-1).numpy()
    predictions = probabilities.argmax(-1)
    metrics = {
        "classification_report": classification_report(test_targets, predictions, target_names=glosses, output_dict=True, zero_division=0),
        "confusion_matrix": confusion_matrix(test_targets, predictions).tolist(),
        "top_1_accuracy": float((predictions == test_targets).mean()),
        "top_5_accuracy": float(top_k_accuracy_score(test_targets, probabilities, k=min(5, len(glosses)), labels=list(range(len(glosses))))),
        "signer_independent": True,
    }
    (args.output / "metrics.json").write_text(json.dumps(metrics, indent=2), encoding="utf-8")
    (args.output / "vocabulary.json").write_text(json.dumps(vocabulary, indent=2), encoding="utf-8")

    model.cpu().eval()
    dummy_features = torch.zeros(1, args.sequence_length, sample.shape[-1])
    dummy_mask = torch.ones(1, args.sequence_length)
    torch.onnx.export(model, (dummy_features, dummy_mask), args.output / "model.onnx", input_names=["features", "mask"], output_names=["logits"], dynamic_axes={"features": {0: "batch"}, "mask": {0: "batch"}, "logits": {0: "batch"}}, opset_version=18)


if __name__ == "__main__":
    main()
