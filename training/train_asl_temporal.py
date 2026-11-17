"""Compare two on-device temporal classifiers on signer-disjoint ASL development data."""

import argparse
from collections import Counter
import hashlib
import json
import math
from pathlib import Path
import subprocess

import numpy as np

from import_popsign_development import archived_recordings, signer_key


SCHEMA = "asl-temporal-v1"
ALGORITHMS = ("centroid", "ridge")
UNKNOWN = "[UNKNOWN]"
SEED = 17
DERIVED = Path("evaluation/derived")


def load(path):
    raw = path.read_bytes()
    payload = json.loads(raw)
    if payload["schema"] != SCHEMA or not payload["rows"]:
        raise ValueError("Unrecognized or empty feature schema")
    return payload, hashlib.sha256(raw).hexdigest()


def validate(train, development):
    sealed, hashes, _ = archived_recordings()
    for field in ("recording_sha256", "group", "trial_id"):
        values = [r[field] for r in [*train, *development]]
        if len(values) != len(set(values)):
            raise ValueError(f"Duplicate {field}")
    signer_sets = [{signer_key(r["signer"]) for r in rows} for rows in (train, development)]
    if signer_sets[0] & signer_sets[1]:
        raise ValueError("Training and evaluation signer sets overlap")
    if any(s & sealed for s in signer_sets) or any(r["recording_sha256"] in hashes for r in [*train, *development]):
        raise ValueError("A sealed signer or recording was supplied")
    if len(signer_sets[0]) < 4:
        raise ValueError("Four training signers are needed for grouped calibration")


def fit(rows, labels, algorithm):
    examples = [row for row in rows if "features" in row]
    features = np.array([row["features"] for row in examples], dtype=np.float64)
    y = np.array([labels.index(row["expected"] if row["kind"] == "target" else UNKNOWN) for row in examples])
    counts = np.bincount(y, minlength=len(labels))
    if not counts.min():
        raise ValueError(f"Missing a fit class: {dict(zip(labels, counts.tolist()))}")
    mean = features.mean(axis=0)
    scale = np.maximum(features.std(axis=0), 0.20)
    x = (features - mean) / scale
    if algorithm == "centroid":
        centers = np.stack([x[y == i].mean(axis=0) for i in range(len(labels))])
        weights = 2 * centers
        bias = -(centers ** 2).sum(axis=1)
    else:
        # Ridge regression in the sample dimension, with class-balanced target
        # weights and an unpenalized intercept from weighted centering.
        w = np.sqrt(len(x) / (len(labels) * counts[y]))
        targets = np.eye(len(labels))[y]
        x_mean = np.average(x, axis=0, weights=w ** 2)
        y_mean = np.average(targets, axis=0, weights=w ** 2)
        z = (x - x_mean) * w[:, None]
        lhs = (z @ z.T) + 8.0 * np.eye(len(z))
        weights = (z.T @ np.linalg.solve(lhs, (targets - y_mean) * w[:, None])).T
        bias = y_mean - weights @ x_mean
    return {"mean": mean.tolist(), "scale": scale.tolist(), "weights": weights.tolist(), "bias": bias.tolist()}


def predict(model, rows, labels):
    result = []
    mean, scale, weights, bias = (np.asarray(model[name]) for name in ("mean", "scale", "weights", "bias"))
    for row in rows:
        prediction = {"trial_id": row["trial_id"], "kind": row["kind"], "expected": row["expected"],
                      "status": row["status"], "top": None, "score": None, "margin": None,
                      "frames": row.get("frames", 0), "observed_frames": row.get("observedFrames", 0),
                      "observed_bins": row.get("observedBins", 0), "first_ready_ms": row.get("firstReady"),
                      "motion_reason": row.get("motionReason"), "quality": row.get("quality")}
        if "features" in row:
            x = (np.asarray(row["features"]) - mean) / scale
            scores = weights @ x + bias
            if model["architecture"] == "centroid":
                scores = (scores - x @ x) / len(x)
            top, next_best = np.argsort(-scores, kind="stable")[:2]
            prediction.update(top=labels[top], score=float(scores[top]), margin=float(scores[top] - scores[next_best]))
        result.append(prediction)
    return result


def accepted(row, threshold):
    if row["top"] in (None, UNKNOWN):
        return None
    return row["top"] if row["score"] >= threshold["score"] and row["margin"] >= threshold["margin"] else None


def interval(count, total):
    if not total:
        return None
    p, z = count / total, 1.96
    mid = p + z * z / (2 * total)
    span = z * math.sqrt((p * (1 - p) + (z * z / (4 * total))) / total)
    return [max(0, (mid - span) / (1 + z * z / total)), min(1, (mid + span) / (1 + z * z / total))]


def metrics(rows, threshold, labels, details=False):
    outcome = Counter()
    by_gloss = {label: Counter() for label in labels if label != UNKNOWN}
    confusion = {}
    for row in rows:
        kind, expected = row["kind"], row["expected"]
        guess = accepted(row, threshold)
        if kind == "target":
            by_gloss[expected]["trials"] += 1
        code = "error" if row["status"] != "complete" else "abstained" if guess is None else "correct" if kind == "target" and guess == expected else "wrong"
        outcome[f"{kind}_{code}"] += 1
        if guess:
            by_gloss[guess]["accepts"] += 1
        if code == "correct":
            by_gloss[expected]["correct"] += 1
        if details:
            actual = expected or "[NO SIGN]"
            confusion.setdefault(actual, Counter())[guess or ("[ERROR]" if code == "error" else "[ABSTAIN]")] += 1
    pos = sum(count for key, count in outcome.items() if key.startswith("target_"))
    neg = sum(count for key, count in outcome.items() if not key.startswith("target_") and not key.endswith("_error"))
    false = sum(count for key, count in outcome.items() if not key.startswith("target_") and key.endswith("_wrong"))
    correct = outcome["target_correct"]
    guesses = correct + outcome["target_wrong"] + false
    result = {"counts": dict(sorted(outcome.items())), "correct": correct, "wrong": outcome["target_wrong"],
              "abstained": outcome["target_abstained"], "negative_false_accepts": false, "negative_total_complete": neg,
              "precision": correct / guesses if guesses else None, "recall": correct / pos if pos else None,
              "negative_false_accept_rate": false / neg if neg else None}
    if details:
        result.update(confusion=confusion,
                      precision_wilson95_iid=interval(correct, guesses), recall_wilson95_iid=interval(correct, pos),
                      negative_wilson95_iid=interval(false, neg),
                      per_gloss={label: {**counts, "precision": counts["correct"] / counts["accepts"] if counts["accepts"] else None,
                                         "recall": counts["correct"] / counts["trials"] if counts["trials"] else None}
                                 for label, counts in by_gloss.items()})
    return result


def choose_threshold(rows, labels):
    candidates = [row for row in rows if row["top"] not in (None, UNKNOWN)]
    if not candidates:
        return {"score": 1e9, "margin": 1e9}
    scores = [min(r["score"] for r in candidates), *np.quantile([r["score"] for r in candidates], np.linspace(0, 1, 19))]
    margins = [0, *np.quantile([r["margin"] for r in candidates], np.linspace(0, 1, 19)), 1e9]
    def ordering(policy):
        m = metrics(rows, policy, labels)
        feasible = (m["precision"] or 0) >= 0.90 and m["negative_false_accept_rate"] is not None and m["negative_false_accept_rate"] <= 0.05
        errors = m["wrong"] + m["negative_false_accepts"]
        return feasible, m["correct"] if feasible else m["correct"] - 4 * errors, -errors, m["correct"]
    return max(({"score": float(score), "margin": float(margin)} for score in scores for margin in margins), key=ordering)


def calibration_predictions(rows, labels, algorithm):
    signers = sorted({row["signer"] for row in rows})
    order = np.random.default_rng(SEED).permutation(signers)
    folds = {signer: i % 4 for i, signer in enumerate(order)}
    predictions = []
    for i in range(4):
        fit_rows = [r for r in rows if folds[r["signer"]] != i]
        test_rows = [r for r in rows if folds[r["signer"]] == i]
        predictions.extend(predict({**fit(fit_rows, labels, algorithm), "architecture": algorithm}, test_rows, labels))
    return predictions


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("train", type=Path)
    parser.add_argument("development", type=Path)
    parser.add_argument("out", type=Path)
    args = parser.parse_args()
    if not args.out.resolve().is_relative_to(DERIVED.resolve()) or args.out.resolve() == DERIVED.resolve():
        parser.error("Export research artifacts under ignored evaluation/derived/")
    train, train_hash = load(args.train)
    development, dev_hash = load(args.development)
    if train["vocabulary"] != development["vocabulary"]:
        raise ValueError("Feature vocabularies differ")
    labels = [*train["vocabulary"], UNKNOWN]
    a, b = train["rows"], development["rows"]
    validate(a, b)
    signers = sorted({row["signer"] for row in a})
    args.out.mkdir(parents=True, exist_ok=False)
    report = {"schema": SCHEMA, "seed": SEED, "code_commit": subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip(),
              "training_features_sha256": train_hash, "development_features_sha256": dev_hash,
              "runtime": {"training": train["runtime"], "development": development["runtime"], "numpy": np.__version__},
              "signers": {"train": len(signers), "development": len({r["signer"] for r in b})},
              "note": "Isolated clip boundaries supplied by the publisher. Intervals assume independent clips and ignore signer clustering.",
              "models": {}}
    for algorithm in ALGORITHMS:
        out_of_fold = calibration_predictions(a, labels, algorithm)
        threshold = choose_threshold(out_of_fold, labels)
        model = {**fit(a, labels, algorithm), "schema": SCHEMA, "architecture": algorithm, "labels": labels, "threshold": threshold,
                 "training_manifest_sha256": train["runtime"]["manifest_sha256"]}
        model_bytes = (json.dumps(model, separators=(",", ":"), allow_nan=False) + "\n").encode()
        (args.out / f"{algorithm}.json").write_bytes(model_bytes)
        prediction = predict(model, b, labels)
        float32 = {**model, **{key: np.asarray(model[key], dtype=np.float32).tolist() for key in ("mean", "scale", "bias", "weights")}}
        rounded = predict(float32, b, labels)
        float32_check = {
            "scored_clips": sum(row["score"] is not None for row in prediction),
            "max_score_delta": max((abs(first["score"] - second["score"])
                                    for first, second in zip(prediction, rounded, strict=True) if first["score"] is not None), default=0),
            "changed_acceptances": sum(accepted(first, threshold) != accepted(second, threshold)
                                       for first, second in zip(prediction, rounded, strict=True)),
        }
        report["models"][algorithm] = {"sha256": hashlib.sha256(model_bytes).hexdigest(), "bytes": len(model_bytes), "threshold": threshold,
            "calibration": metrics(out_of_fold, threshold, labels, details=True),
            "development": metrics(prediction, threshold, labels, details=True),
            "development_without_threshold": metrics(prediction, {"score": -1e9, "margin": 0}, labels, details=True),
            "float32_weight_check": float32_check}
        for row in prediction:
            row["accepted"] = accepted(row, threshold)
        (args.out / f"{algorithm}-trials.json").write_text(json.dumps(prediction, indent=2) + "\n", encoding="utf-8")
    (args.out / "report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
