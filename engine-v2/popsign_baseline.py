"""Subset approximation of PopSignAI's 2D hand input and closed-set 1D CNN."""
import argparse
import json
from pathlib import Path

import numpy as np

from train import LABELS, fit, forward, windows


def input_sequence(trace):
    sequences = {"Left": [], "Right": []}
    for frame in trace["frames"]:
        for side in sequences:
            hand = next((hand for hand in frame["hands"] if hand["handedness"] == side
                         and len(hand["landmarks"]) == 21), None)
            if hand is None:
                continue
            xy = np.asarray([[point["x"], point["y"]] for point in hand["landmarks"]], np.float32)
            if not np.isfinite(xy).all():
                continue
            if side == "Left":
                xy[:, 0] = 1 - xy[:, 0]
            sequences[side].append(xy.ravel())
    samples = max(sequences.values(), key=len)
    if not samples:
        return None
    if len(samples) >= 60:
        first = (len(samples) - 60) // 2
        return samples[first:first + 60]
    missing = 60 - len(samples)
    center = samples[len(samples) // 2]
    return [center] * (missing // 2) + samples + [center] * (missing - missing // 2)


def gather(path, intake):
    dataset = json.loads(path.read_text(encoding="utf-8"))
    rows = []
    for row in dataset["rows"]:
        if row["label"] == "OTHER":
            continue
        trace = json.loads(Path(intake[row["sha256"]]).read_text(encoding="utf-8"))
        if trace["recording_sha256"] != row["sha256"]:
            raise ValueError("Trace does not match guarded development intake")
        rows.append((row, input_sequence(trace)))
    return rows


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("data", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    entries = json.loads((args.data / "intake.json").read_text(encoding="utf-8"))
    intake = {entry["sha256"]: entry["trace"] for entry in entries}
    training = gather(args.data / "train.json", intake)
    validation = gather(args.data / "val.json", intake)
    if {row["signer"] for row, _ in training} & {row["signer"] for row, _ in validation}:
        raise ValueError("Signers overlap")
    prepared = [(LABELS.index(row["label"]), value) for row, value in training if value is not None]
    parameters, mean, scale = fit(np.asarray([value for _, value in prepared], np.float32),
                                  np.array([label for label, _ in prepared]), 11, 64, 24, False, classes=5)
    records = {}
    eligible = [(row, value) for row, value in validation if value is not None]
    logits = forward(windows(np.asarray([value for _, value in eligible], np.float32), mean, scale), parameters)[0]
    correct = 0
    for (row, _), output in zip(eligible, logits):
        label = row["label"]
        prediction = LABELS[int(output.argmax())]
        matches = records.setdefault(label, {})
        matches[prediction] = matches.get(prediction, 0) + 1
        correct += label == prediction
    evidence = {"protocol": "PopSignAI subset approximation, five-way closed-set",
                "targets": len(validation), "scored": len(eligible), "correct": correct,
                "trainClips": len(training), "scorableTrainClips": len(prepared), "confusion": records,
                "accuracyAllClips": correct / len(validation)}
    args.output.write_text(json.dumps(evidence, indent=2), encoding="utf-8")
    print(json.dumps(evidence))
