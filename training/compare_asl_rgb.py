"""Compare RGB hand-region gradients and a landmark/RGB hybrid on matched clips."""

import argparse
import hashlib
import json
from pathlib import Path
from time import perf_counter

import cv2
import numpy as np

from train_asl_temporal import (
    DERIVED, UNKNOWN, calibration_predictions, choose_threshold, fit, load, metrics, predict, validate,
)


PHASES = 6
HOG = cv2.HOGDescriptor((32, 32), (16, 16), (16, 16), (8, 8), 8)


def crop_descriptor(image, hand):
    height, width = image.shape[:2]
    points = np.array([(p["x"] * width, p["y"] * height) for p in hand["landmarks"]])
    if not np.isfinite(points).all():
        return None
    low, high = points.min(axis=0), points.max(axis=0)
    size = max(high - low) * 1.3
    if size < 12:
        return None
    x, y = (low + high) / 2
    left, right = max(0, round(x - size / 2)), min(width, round(x + size / 2))
    top, bottom = max(0, round(y - size / 2)), min(height, round(y + size / 2))
    if right - left < 0.7 * size or bottom - top < 0.7 * size:
        return None
    crop = cv2.cvtColor(image[top:bottom, left:right], cv2.COLOR_BGR2GRAY)
    crop = cv2.resize(crop, (32, 32), interpolation=cv2.INTER_AREA)
    if hand["handedness"] == "Left":
        crop = cv2.flip(crop, 1)
    return HOG.compute(crop).ravel()


def describe(file, frames):
    # Use only genuine track observations to locate hand crops. Scores come
    # from image gradients, plus an explicit mask for empty temporal bins.
    tracked = {}
    for frame in frames:
        hands = [hand for hand in frame["hands"] if 0 <= hand["landmarks"][0]["x"] <= 1
                 and 0 <= hand["landmarks"][0]["y"] <= 1]
        if hands:
            tracked[frame["timestamp"]] = hands
    if len(tracked) < 5:
        return None
    start, end = min(tracked), max(tracked)
    if end - start < 180:
        return None
    camera = cv2.VideoCapture(str(file), cv2.CAP_FFMPEG)
    sums = np.zeros((PHASES, HOG.getDescriptorSize()))
    counts = np.zeros(PHASES)
    seen = set()
    try:
        while True:
            ok, image = camera.read()
            if not ok:
                break
            time = round(camera.get(cv2.CAP_PROP_POS_MSEC))
            if time not in tracked:
                continue
            seen.add(time)
            phase = min(PHASES - 1, int((time - start) / (end - start) * PHASES))
            for hand in tracked[time]:
                descriptor = crop_descriptor(image, hand)
                if descriptor is not None:
                    sums[phase] += descriptor
                    counts[phase] += 1
    finally:
        camera.release()
    if seen != tracked.keys():
        raise ValueError("RGB decoder returned different source timestamps from the landmark pass")
    if not counts.any():
        return None
    return np.column_stack((counts > 0, sums / np.maximum(counts, 1)[:, None])).ravel().tolist()


def rgb_features(features_path, manifest_path, traces):
    dataset, _ = load(features_path)
    manifest_bytes = manifest_path.read_bytes()
    if hashlib.sha256(manifest_bytes).hexdigest() != dataset["runtime"]["manifest_sha256"]:
        raise ValueError("Manifest and feature fingerprints differ")
    raw_runtime = json.loads((traces / "runtime.json").read_text(encoding="utf-8"))
    if raw_runtime != dataset["runtime"]:
        raise ValueError("Tracing runtime and feature fingerprints differ")
    manifest = {r["recording_sha256"]: r for r in json.loads(manifest_bytes)}
    results = []
    videos = Path("evaluation/videos").resolve()
    for row in dataset["rows"]:
        digest = row["recording_sha256"]
        file = Path(manifest[digest]["file"]).resolve()
        if not file.is_relative_to(videos) or hashlib.sha256(file.read_bytes()).hexdigest() != digest:
            raise ValueError("Video path or fingerprint differs")
        raw = json.loads((traces / (digest + ".json")).read_text(encoding="utf-8"))
        if raw["trial_id"] != row["trial_id"] or raw["recording_sha256"] != digest or raw["status"] != row["status"]:
            raise ValueError("Trace identity differs")
        result = {"row": row, "rgb": describe(file, raw["frames"]) if raw["status"] == "complete" else None}
        results.append(result)
    return dataset, results


def select(rows, mode):
    landmark_width = len(next(item["row"]["features"] for item in rows if "features" in item["row"]))
    rgb_width = PHASES * (HOG.getDescriptorSize() + 1)
    for item in rows:
        row = dict(item["row"])
        landmark = row.pop("features", None)
        rgb = item["rgb"]
        if mode == "landmarks" and landmark is not None:
            row["features"] = landmark
        elif mode == "rgb" and rgb is not None:
            row["features"] = rgb
        elif mode == "hybrid" and (landmark is not None or rgb is not None):
            row["features"] = [*(landmark or [0.0] * landmark_width), *(rgb or [0.0] * rgb_width)]
        yield row


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("train_features", type=Path)
    parser.add_argument("train_manifest", type=Path)
    parser.add_argument("train_traces", type=Path)
    parser.add_argument("val_features", type=Path)
    parser.add_argument("val_manifest", type=Path)
    parser.add_argument("val_traces", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    if not args.output.resolve().is_relative_to(DERIVED.resolve()):
        parser.error("Use an ignored evaluation/derived output")
    train, train_hash = load(args.train_features)
    val, val_hash = load(args.val_features)
    validate(train["rows"], val["rows"])
    cv2.setNumThreads(1)
    start = perf_counter()
    train, a = rgb_features(args.train_features, args.train_manifest, args.train_traces)
    val, b = rgb_features(args.val_features, args.val_manifest, args.val_traces)
    labels = [*train["vocabulary"], UNKNOWN]
    if train["vocabulary"] != val["vocabulary"]:
        raise ValueError("Feature vocabularies differ")
    report = {"schema": "asl-rgb-hog-v1", "extraction_seconds": perf_counter() - start,
              "train_features_sha256": train_hash, "val_features_sha256": val_hash, "opencv": cv2.__version__, "models": {}}
    for mode in ("landmarks", "rgb", "hybrid"):
        training, validation = list(select(a, mode)), list(select(b, mode))
        calibration = calibration_predictions(training, labels, "ridge")
        threshold = choose_threshold(calibration, labels)
        model = {**fit(training, labels, "ridge"), "architecture": "ridge"}
        result = predict(model, validation, labels)
        report["models"][mode] = {"threshold": threshold, "calibration": metrics(calibration, threshold, labels),
                                   "validation": metrics(result, threshold, labels, details=True),
                                   "descriptors": [sum("features" in r for r in rows) for rows in (training, validation)]}
    with args.output.open("x", encoding="utf-8") as output:
        json.dump(report, output, indent=2)
        output.write("\n")


if __name__ == "__main__":
    main()
