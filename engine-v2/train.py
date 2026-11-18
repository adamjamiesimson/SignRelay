"""Fit small temporal convolution models using signer-grouped calibration."""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np

LABELS = ["HELLO", "THANK YOU", "PLEASE", "YES", "NO", "OTHER"]
WIDTHS = {"landmark": 87, "rgb": 432, "hybrid": 519}
STEPS = 16
CONTRACT = "signrelay-v2-temporal-1"


def feature_tensor(samples, mode):
    if any(not np.isfinite(sample["t"]) or (index and sample["t"] <= samples[index - 1]["t"])
           for index, sample in enumerate(samples)):
        raise ValueError("Non-monotonic source timestamps")
    hands = [sample for sample in samples if sample["h"]]
    if len(hands) < 3 or hands[-1]["t"] - hands[0]["t"] < 115:
        return None
    start, end = hands[0]["t"], hands[-1]["t"]
    times = np.array([s["t"] for s in samples])
    result = np.zeros((STEPS, WIDTHS[mode]), dtype=np.float32)
    for i in range(STEPS):
        when = start + (end - start) * i / (STEPS - 1)
        index = np.abs(times - when).argmin()
        if abs(times[index] - when) > 100:
            continue
        sample = samples[index]
        if mode != "rgb":
            result[i, :87] = sample["x"]
        if mode != "landmark" and sample["rgb"] is not None:
            result[i, -432:] = sample["rgb"]
    return result


def windows(x, mean, scale):
    x = np.clip((x - mean) / scale, -5, 5).astype(np.float32)
    padded = np.pad(x, ((0, 0), (1, 1), (0, 0)), mode="edge")
    return np.concatenate([padded[:, i:i + x.shape[1]] for i in range(3)], axis=-1)


def forward(context, parameters):
    conv, bias, head, offset = parameters
    a = np.tanh(context @ conv + bias)
    pooled = a.reshape(len(a), 4, a.shape[1] // 4, -1).mean(axis=2).reshape(len(a), -1)
    return pooled @ head + offset, a, pooled


def fit(x, y, seed, epochs, channels, augment, classes=len(LABELS)):
    rng = np.random.default_rng(seed)
    if set(y) != set(range(classes)):
        raise ValueError("Training fold lost a class")
    mean = x.mean(axis=(0, 1))
    scale = np.maximum(x.std(axis=(0, 1)), 0.08)
    base = windows(x, mean, scale)
    weights = len(y) / (np.bincount(y)[y] * classes)
    dim = base.shape[-1]
    parameters = [rng.normal(0, 1 / np.sqrt(dim), (dim, channels)).astype(np.float32),
                  np.zeros(channels, np.float32),
                  rng.normal(0, 0.1, (channels * 4, classes)).astype(np.float32),
                  np.zeros(classes, np.float32)]
    average = [np.zeros_like(p) for p in parameters]
    squares = [np.zeros_like(p) for p in parameters]
    step = 0
    for epoch in range(epochs):
        order = rng.permutation(len(y))
        for indices in np.array_split(order, max(1, len(order) // 20)):
            context = base[indices]
            if augment:
                # Perturb sampling and missing observations without creating negative labels.
                offsets = rng.uniform(-1.7, 1.7, (len(indices), 1))
                rate = rng.uniform(0.86, 1.14, (len(indices), 1))
                positions = np.clip(np.rint((np.arange(STEPS) - 7.5) * rate + 7.5 + offsets), 0, 15).astype(int)
                inputs = x[indices[:, None], positions].copy()
                inputs[rng.random(inputs.shape[:2]) < 0.08] = 0
                context = windows(inputs, mean, scale)
            scores, a, pooled = forward(context, parameters)
            exp = np.exp(scores - scores.max(axis=1, keepdims=True))
            error = exp / exp.sum(axis=1, keepdims=True)
            error[np.arange(len(indices)), y[indices]] -= 1
            error *= (weights[indices] / len(indices)).astype(np.float32)[:, None]
            upstream = (error @ parameters[2].T).reshape(len(indices), 4, channels)
            pool_width = a.shape[1] // 4
            change = np.repeat(upstream, pool_width, axis=1) * (1 - a**2) / pool_width
            derivative = [context.reshape(-1, dim).T @ change.reshape(-1, channels) + 0.001 * parameters[0],
                          change.sum(axis=(0, 1)), pooled.T @ error + 0.001 * parameters[2], error.sum(axis=0)]
            step += 1
            rate = 0.004 * (1 - 0.8 * epoch / epochs)
            for p, m, v, g in zip(parameters, average, squares, derivative):
                m *= 0.9
                m += 0.1 * g
                v *= 0.999
                v += 0.001 * g**2
                p -= rate * (m / (1 - 0.9**step)) / (np.sqrt(v / (1 - 0.999**step)) + 1e-8)
    return parameters, mean, scale


def scores(model, data, indices):
    parameters, mean, scale = model
    outputs = forward(windows(data[indices], mean, scale), parameters)[0]
    return {int(index): row for index, row in zip(indices, outputs)}


def stream_scores(model, rows, indices, mode):
    """Evaluate the causal windows used at native cadence on out-of-fold clips."""
    entries = {}
    for index in indices:
        samples = rows[index]["samples"]
        history = []
        last = evaluated = float("-inf")
        tensors = []
        counts = []
        cadence = 50
        for sample in samples:
            now = sample["t"]
            gap = now - last
            last = now
            if gap > 400:
                history = []
                evaluated = float("-inf")
                cadence = 50
            else:
                cadence = cadence * 0.7 + gap * 0.3
            history = [item for item in history if now - item["t"] <= 1600] + [sample]
            if now - evaluated < 150:
                continue
            evaluated = now
            window_sizes = [600, 1000, 1600] if cadence >= 125 else [1000]
            selected = []
            for size in window_sizes:
                if now - history[0]["t"] >= size - max(size * 0.14, min(220, gap + 10)):
                    value = feature_tensor([item for item in history if now - item["t"] <= size], mode)
                    if value is not None:
                        selected.append(value)
            counts.append((len(selected), gap > 400))
            tensors.extend(selected)
        values = scores(model, np.asarray(tensors), np.arange(len(tensors))) if tensors else {}
        cursor = 0
        sequence = []
        for count, reset in counts:
            proposals = []
            for i in range(cursor, cursor + count):
                ranking = np.argsort(-values[i], kind="stable")
                winner, other = ranking[:2]
                if winner != len(LABELS) - 1:
                    proposals.append((LABELS[winner], float(values[i][winner]), float(values[i][winner] - values[i][other])))
            sequence.append((reset, sorted(proposals, key=lambda row: -row[2])))
            cursor += count
        entries[int(index)] = sequence
    return entries


def stream_decisions(rows, outputs, cutoff):
    chosen = []
    for index, _ in enumerate(rows):
        previous = emitted = None
        run = 0
        accepted = []
        for reset, proposals in outputs[index]:
            if reset:
                previous = emitted = None
                run = 0
            label = next((label for label, score, margin in proposals if score >= cutoff[0] and margin >= cutoff[1]), None)
            run = run + 1 if label == previous else 1
            previous = label
            if run >= 2 and label != emitted:
                emitted = label
                if label:
                    accepted.append(label)
        chosen.append(", ".join(accepted) if accepted else None)
    return chosen


def decisions(rows, outputs, cutoff):
    chosen = []
    for index, _ in enumerate(rows):
        values = outputs.get(index)
        if values is None:
            chosen.append(None)
            continue
        ranking = np.argsort(-values, kind="stable")
        winner, other = ranking[:2]
        accepted = winner != len(LABELS) - 1 and values[winner] >= cutoff[0] and values[winner] - values[other] >= cutoff[1]
        chosen.append(LABELS[winner] if accepted else None)
    return chosen


def summarize(rows, chosen):
    matrix = {}
    positives = [index for index, row in enumerate(rows) if row["label"] != "OTHER"]
    negatives = [index for index, row in enumerate(rows) if row["label"] == "OTHER"]
    for row, predicted in zip(rows, chosen):
        entries = matrix.setdefault(row["expected"], {})
        name = predicted or "ABSTAIN"
        entries[name] = entries.get(name, 0) + 1
    correct = sum(chosen[i] == rows[i]["label"] for i in positives)
    wrong = sum(chosen[i] is not None and chosen[i] != rows[i]["label"] for i in positives)
    false = sum(chosen[i] is not None for i in negatives)
    return {"correct": correct, "wrong": wrong, "abstained": len(positives) - correct - wrong,
            "targets": len(positives), "false_accepts": false, "negatives": len(negatives),
            "precision": correct / (correct + wrong + false) if correct + wrong + false else None,
            "recall": correct / len(positives), "confusion": matrix}


def choose_cutoff(rows, outputs, classify=decisions):
    best = None
    for score in [-20, 0, 0.5, 1, 1.5, 2, 2.5, 3, 4, 8, 20]:
        for margin in [0, 0.25, 0.5, 0.75, 1, 1.5, 2, 2.5, 3, 4, 8]:
            cutoff = (score, margin)
            result = summarize(rows, classify(rows, outputs, cutoff))
            if result["false_accepts"] > int(result["negatives"] * 0.12):
                continue
            key = (result["correct"] - result["wrong"], result["correct"], -result["false_accepts"])
            if best is None or key > best[0]:
                best = (key, cutoff, result)
    if best is None:
        raise ValueError("Calibration grid needs a stricter rejection option")
    return best[1], best[2]


def dataset(path, mode):
    raw = json.loads(path.read_text(encoding="utf-8"))
    if raw["contract"] != CONTRACT:
        raise ValueError("Feature version mismatch")
    rows = raw["rows"]
    data = np.zeros((len(rows), STEPS, WIDTHS[mode]), dtype=np.float32)
    valid = []
    for index, row in enumerate(rows):
        reference = feature_tensor(row["samples"], mode)
        given = row["inputs"][mode]
        if reference is None and given is None:
            continue
        if (reference is None or given is None or not np.isfinite(reference).all()
                or not np.array_equal(reference.ravel(), np.asarray(given, np.float32))):
            raise ValueError("JavaScript and Python time resampling disagree")
        valid.append(index)
        data[index] = reference
    return rows, data, np.array(valid), raw["upstream"]


def run(args, mode):
    train_rows, train_x, train_valid, upstream = dataset(args.data / "train.json", mode)
    val_rows, val_x, val_valid, validation = dataset(args.data / "val.json", mode)
    signer_ids = sorted({row["signer"] for row in train_rows})
    groups = dict(zip(np.random.default_rng(241).permutation(signer_ids), np.arange(len(signer_ids)) % 4))
    if set(signer_ids) & {row["signer"] for row in val_rows}:
        raise ValueError("Signer leaked into validation")
    if {row["sha256"] for row in train_rows} & {row["sha256"] for row in val_rows}:
        raise ValueError("Recording leaked into validation")
    split = np.array([groups[row["signer"]] for row in train_rows])
    y = np.array([LABELS.index(row["label"]) for row in train_rows])
    cv = {}
    stream_cv = {}
    for fold in range(4):
        training = train_valid[split[train_valid] != fold]
        withheld = train_valid[split[train_valid] == fold]
        model = fit(train_x[training], y[training], 900 + fold, args.epochs, args.channels, args.augment)
        cv.update(scores(model, train_x, withheld))
        if args.calibrate_stream:
            stream_cv.update(stream_scores(model, train_rows, np.flatnonzero(split == fold), mode))
    cutoff, calibration = choose_cutoff(train_rows, cv)
    final = fit(train_x[train_valid], y[train_valid], 904, args.epochs, args.channels, args.augment)
    result = scores(final, val_x, val_valid)
    parameters, mean, scale = final
    detector = "hand" if upstream.get("independentDetector") else "rebirth-tracks"
    version = f"v2-{mode}-tcn-{args.channels}-{args.epochs}-{detector}" + ("-aug" if args.augment else "")
    stream_profile = {}
    stream_accepted = None
    if args.calibrate_stream:
        stream_cutoff, stream_calibration = choose_cutoff(train_rows, stream_cv, stream_decisions)
        validation_stream = stream_scores(final, val_rows, np.arange(len(val_rows)), mode)
        stream_accepted = stream_decisions(val_rows, validation_stream, stream_cutoff)
        stream_profile = {
            "stream": summarize(val_rows, stream_accepted),
            "stream_calibration": stream_calibration, "stream_score_cutoff": stream_cutoff[0],
            "stream_margin_cutoff": stream_cutoff[1],
        }
        version += "-stream"
    artifact = {"contract": CONTRACT, "version": version, "mode": mode, "labels": LABELS, "steps": STEPS,
                "channels": args.channels, "mean": mean.tolist(), "scale": scale.tolist(),
                "minScore": cutoff[0], "minMargin": cutoff[1],
                "trainingManifest": upstream["manifest_sha256"], "tracker": upstream.get("independentDetector")}
    artifact.update({name: value.ravel().tolist() for name, value in zip(["conv", "bias", "head", "offset"], parameters)})
    if stream_profile:
        artifact.update(streamScore=stream_profile["stream_score_cutoff"], streamMargin=stream_profile["stream_margin_cutoff"])
    payload = json.dumps(artifact, separators=(",", ":")).encode()
    (args.output / (mode + ".json")).write_bytes(payload)
    report = {"version": version, "sha256": hashlib.sha256(payload).hexdigest(),
              "bytes": len(payload), "calibration": calibration,
              "closed_set_with_other": summarize(val_rows, decisions(val_rows, result, (-100, 0))),
              "isolated": summarize(val_rows, decisions(val_rows, result, cutoff)),
              "training": {"signers": len(signer_ids), "clips": len(train_rows), "scorable": len(train_valid),
                           "source": upstream},
              "development": {"signers": len({row["signer"] for row in val_rows}), "clips": len(val_rows),
                              "scorable": len(val_valid), "source": validation},
              "score_cutoff": cutoff[0], "margin_cutoff": cutoff[1], **stream_profile}
    (args.output / (mode + "-metrics.json")).write_text(json.dumps(report, indent=2), encoding="utf-8")
    (args.output / (mode + "-parity.json")).write_text(json.dumps({
        "scores": [result[i].tolist() if i in result else None for i in range(len(val_rows))],
        "accepted": decisions(val_rows, result, cutoff),
        "stream_accepted": stream_accepted,
    }), encoding="utf-8")
    print(json.dumps({key: report[key] for key in ("version", "isolated", "score_cutoff", "margin_cutoff")}), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("data", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--epochs", type=int, default=64)
    parser.add_argument("--channels", type=int, default=24)
    parser.add_argument("--augment", action="store_true")
    parser.add_argument("--calibrate-stream", action="store_true")
    parser.add_argument("--mode", choices=WIDTHS, action="append")
    args = parser.parse_args()
    if args.epochs < 1 or not 1 <= args.channels <= 64:
        parser.error("Use positive epochs and 1–64 channels")
    args.output.mkdir(parents=True, exist_ok=True)
    for mode in args.mode or WIDTHS:
        run(args, mode)
