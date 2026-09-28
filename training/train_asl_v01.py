"""Small CPU-only ASL experiment. Never activates or overwrites a browser model.

The source derivative cannot support signer-independent evaluation. Explicit
--exploratory is required; all reports retain this limitation and release gates.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
from pathlib import Path
import random
import time

import numpy as np


def split_groups(y, hashes, seed=42):
    """Stratify distinct exact sequences, keeping duplicates in the same split."""
    groups = {}
    for index, digest in enumerate(hashes):
        groups.setdefault(str(digest), []).append(index)
    if any(len(set(int(y[i]) for i in group)) != 1 for group in groups.values()):
        raise ValueError("Identical landmark sequences have conflicting labels")
    rng = np.random.default_rng(seed)
    splits = {"train": [], "validation": [], "test": []}
    for label in sorted(set(y.tolist())):
        candidates = sorted(key for key, group in groups.items() if y[group[0]] == label)
        if len(candidates) < 5:
            raise ValueError(f"Class {label} has too few distinct sequences for three splits")
        rng.shuffle(candidates)
        held = max(1, int(round(len(candidates) * 0.2)))
        partitions = {"test": candidates[:held], "validation": candidates[held:held*2],
                      "train": candidates[held*2:]}
        for name, keys in partitions.items():
            splits[name].extend(index for key in keys for index in groups[key])
    return {key: np.array(sorted(value), dtype=np.int64) for key, value in splits.items()}


def fit_normalization(samples):
    observed = np.any(samples != 0, axis=-1, keepdims=True)
    count = observed.sum(axis=(0, 1)).clip(1)
    mean = np.where(observed, samples, 0).sum(axis=(0, 1)) / count
    variance = np.where(observed, (samples - mean) ** 2, 0).sum(axis=(0, 1)) / count
    return mean.astype(np.float32), np.sqrt(variance).clip(0.05).astype(np.float32)


def normalize(samples, mean, scale):
    # The publisher has not specified the anatomy of the 76 positions. Learn
    # only per-coordinate statistics, from training rows, without inventing it.
    mask = np.any(samples != 0, axis=-1, keepdims=True)
    return np.where(mask, (samples - mean) / scale, 0).clip(-8, 8).astype(np.float32)


def classification_report(labels, predictions, classes):
    matrix = np.zeros((len(classes), len(classes)), dtype=np.int64)
    for expected, actual in zip(labels, predictions):
        matrix[int(expected), int(actual)] += 1
    per_class = []
    for i, name in enumerate(classes):
        tp = int(matrix[i, i])
        precision = tp / max(1, int(matrix[:, i].sum()))
        recall = tp / max(1, int(matrix[i].sum()))
        f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0
        per_class.append(dict(label=name, support=int(matrix[i].sum()), precision=precision, recall=recall, f1=f1))
    return {"top1": float(np.mean(labels == predictions)),
            "macro_f1": float(np.mean([row["f1"] for row in per_class])),
            "balanced_accuracy": float(np.mean([row["recall"] for row in per_class])),
            "per_class": per_class, "confusion_matrix": matrix.tolist()}


def train(data_path, output, epochs=120, seed=42):
    import torch
    from torch import nn

    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.set_num_threads(2)
    torch.use_deterministic_algorithms(True)
    with np.load(data_path, allow_pickle=False) as archive:
        X, y = archive["X"], archive["y"]
        labels = archive["labels"].tolist()
        ids, hashes = archive["sample_ids"], archive["sequence_hashes"]
    if X.ndim != 4 or X.shape[1:] != (96, 76, 3) or not np.isfinite(X).all():
        raise ValueError("Expected finite [N, 96, 76, 3] input; run prepare_asl_v01.py")
    if y.shape != (len(X),) or len(ids) != len(X) or len(hashes) != len(X):
        raise ValueError("Sample metadata does not align with input")
    if set(y.tolist()) != set(range(len(labels))):
        raise ValueError("Label indices do not match vocabulary")
    actual_hashes = [hashlib.sha256(sample.astype("<f4").tobytes()).hexdigest() for sample in X]
    if actual_hashes != hashes.tolist():
        raise ValueError("Input sequence hashes changed; re-prepare the dataset")
    splits = split_groups(y, hashes, seed)
    mean, scale = fit_normalization(X[splits["train"]])
    tensors = torch.from_numpy(normalize(X, mean, scale).reshape(len(X), 96, 228).transpose(0, 2, 1).copy())
    targets = torch.from_numpy(y.astype(np.int64))
    model = nn.Sequential(
        nn.Conv1d(228, 96, 5, padding=2), nn.GELU(), nn.Dropout(0.2),
        nn.Conv1d(96, 96, 5, padding=2), nn.GELU(), nn.Dropout(0.2),
        nn.Conv1d(96, 64, 3, padding=1), nn.GELU(),
        nn.AdaptiveAvgPool1d(1), nn.Flatten(), nn.Linear(64, len(labels)),
    )
    optimizer = torch.optim.AdamW(model.parameters(), lr=0.001, weight_decay=0.01)
    loss_fn = nn.CrossEntropyLoss()
    generator = torch.Generator().manual_seed(seed)
    loader = torch.utils.data.DataLoader(
        torch.utils.data.TensorDataset(tensors[splits["train"]], targets[splits["train"]]),
        batch_size=32, shuffle=True, generator=generator, num_workers=0,
    )
    best_loss, best_epoch, best_state = float("inf"), 0, None
    history = []
    started = time.monotonic()
    for epoch in range(1, epochs + 1):
        model.train()
        total_loss = 0.0
        for features, expected in loader:
            optimizer.zero_grad(set_to_none=True)
            loss = loss_fn(model(features), expected)
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            total_loss += float(loss.detach()) * len(features)
        model.eval()
        with torch.no_grad():
            logits = model(tensors[splits["validation"]])
            val_loss = float(loss_fn(logits, targets[splits["validation"]]))
            val_accuracy = float((logits.argmax(1) == targets[splits["validation"]]).float().mean())
        history.append(dict(epoch=epoch, train_loss=total_loss / len(splits["train"]),
                            validation_loss=val_loss, validation_top1=val_accuracy))
        if val_loss < best_loss - 0.0001:
            best_loss, best_epoch, best_state = val_loss, epoch, copy.deepcopy(model.state_dict())
        if epoch == 1 or epoch % 10 == 0:
            print(f"Epoch {epoch}: validation loss {val_loss:.4f}, exploratory top-1 {val_accuracy:.3f}", flush=True)
        if epoch - best_epoch >= 20:
            break
    if best_state is None:
        raise ValueError("No finite validation checkpoint was produced")
    model.load_state_dict(best_state)
    model.eval()
    output.mkdir(parents=True, exist_ok=True)
    torch.save({"state_dict": best_state, "labels": labels, "mean": torch.from_numpy(mean),
                "scale": torch.from_numpy(scale), "input": [1, 228, 96],
                "activation_ready": False}, output / "candidate.pt")
    report = {
        "status": "exploratory_only", "activation_ready": False,
        "evaluation": "Exact-duplicate-grouped stratified random holdout; NOT signer-independent or live accuracy",
        "limitations": ["Source has no signer/video IDs or publisher test split",
                        "Near-duplicates and signer overlap cannot be ruled out",
                        "Joint mapping is unverified; incompatible with live adapter until documented",
                        "20 classes, very small per-class support, no NO_SIGN or out-of-vocabulary test"],
        "seed": seed, "torch": torch.__version__, "numpy": np.__version__, "device": "cpu",
        "data_sha256": hashlib.sha256(data_path.read_bytes()).hexdigest(),
        "parameters": sum(p.numel() for p in model.parameters()), "best_epoch": best_epoch,
        "elapsed_seconds": time.monotonic() - started,
        "split_counts": {name: len(indices) for name, indices in splits.items()},
        "split_sample_ids": {name: ids[indices].tolist() for name, indices in splits.items()},
        "labels": labels, "history": history,
    }
    with torch.no_grad():
        for name in ["validation", "test"]:
            indices = splits[name]
            probabilities = model(tensors[indices]).softmax(1).numpy()
            predictions = probabilities.argmax(1)
            metrics = classification_report(y[indices], predictions, labels)
            metrics["top5"] = float(np.mean([expected in top for expected, top in
                                             zip(y[indices], np.argsort(probabilities, axis=1)[:, -5:])]))
            metrics["predictions"] = [dict(sample_id=str(ids[i]), expected=labels[int(y[i])],
                                            predicted=labels[int(p)], confidence=float(c.max()))
                                      for i, p, c in zip(indices, predictions, probabilities)]
            report[name] = metrics
    (output / "evaluation.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({key: report[key] for key in ["status", "best_epoch", "parameters", "split_counts"]}, indent=2))
    print(f"Exploratory test top-1: {report['test']['top1']:.3f}. Candidate NOT installed in SignRelay.")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=Path("work/asl-v01/data/v01_landmarks.npz"))
    parser.add_argument("--output", type=Path, default=Path("work/asl-v01/experiment"))
    parser.add_argument("--epochs", type=int, default=120)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--exploratory", action="store_true")
    args = parser.parse_args()
    if not args.exploratory:
        parser.error("This derivative lacks signer provenance. Use --exploratory for research only; no browser activation is permitted.")
    if args.epochs < 1 or args.epochs > 500:
        parser.error("epochs must be between 1 and 500")
    train(args.data, args.output, args.epochs, args.seed)


if __name__ == "__main__":
    main()
