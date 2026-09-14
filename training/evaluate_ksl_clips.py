"""Compare Korean PyTorch/ONNX predictions on labelled isolated-sign videos.

Research only. Videos must be named with exact checkpoint labels. This does
not establish signer-independent accuracy or continuous live recognition.
"""
from __future__ import annotations

import argparse
import importlib
import json
from pathlib import Path
import time

from export_ksl_onnx import load_source_model, sha256, SOURCE_HASHES

EXTRACTOR_SHA256 = "f8fde1664d7e61604bd430f3e9c0959068ad2258d5b8a97a1a57455f756c0215"
TASK_SHA256 = "e2dab61191e2dcd0a15f943d8e3ed1dce13c82dfa597b9dd39f562975a50c3f8"


def evaluate(source: Path, exported: Path, videos: Path, output: Path,
             dataset_source: str, use_tasks: bool = False):
    import cv2
    import mediapipe as mp
    import numpy as np
    import onnxruntime as ort
    import torch

    source, exported = source.resolve(), exported.resolve()
    if sha256(source / "model/keypoint_extractor.py") != EXTRACTOR_SHA256:
        raise ValueError("Pinned extractor checksum mismatch")
    report = json.loads((exported / "verification.json").read_text())
    if report["checkpointSha256"] != SOURCE_HASHES["best.pt"]:
        raise ValueError("Wrong source checkpoint in export report")
    if sha256(exported / "model.onnx") != report["modelSha256"]:
        raise ValueError("Exported model checksum mismatch")
    model, labels, _ = load_source_model(source)
    torch.set_num_threads(2)
    torch.backends.mha.set_fastpath_enabled(False)
    extractor_module = importlib.import_module("_signrelay_ksl_source.keypoint_extractor")
    extractor = extractor_module.HolisticKeypointExtractor(
        extractor_module.HolisticExtractorConfig(target_fps=15, max_frames=64))
    if use_tasks:
        task = source / "model/assets/holistic_landmarker.task"
        if sha256(task) != TASK_SHA256:
            raise ValueError("Pinned Holistic task checksum mismatch")
        extractor.config.task_model_path = str(task)
        # Upstream prefers legacy when installed. Explicitly select Tasks to
        # measure both backends without silently changing the reported method.
        extractor._legacy_holistic = None
    # Record the actual extractor implementation: legacy and Tasks may differ.
    backend = "legacy Holistic" if extractor._legacy_holistic is not None else "Tasks"
    options = ort.SessionOptions()
    options.intra_op_num_threads = 2
    session = ort.InferenceSession(str(exported / "model.onnx"), options,
                                   providers=["CPUExecutionProvider"])
    paths = sorted(videos.glob("*.mp4"))
    if not paths:
        raise ValueError("No labelled MP4 clips found")
    if any(path.stem not in labels for path in paths):
        raise ValueError("Every video filename must be an exact checkpoint label")
    results = []
    try:
        for path in paths:
            started = time.perf_counter()
            raw = extractor.extract_video(path)
            extraction_ms = round((time.perf_counter() - started) * 1000)
            length = len(raw)
            if length == 0 or raw.shape != (length, 115, 4) or length > 64:
                raise ValueError(f"Invalid extracted clip: {path.name}")
            if not np.isfinite(raw).all():
                raise ValueError(f"Nonfinite extracted clip: {path.name}")
            packed = np.zeros((1, 64, 115, 4), dtype=np.float32)
            packed[0, :length] = raw
            lengths = np.array([length], dtype=np.int64)
            with torch.no_grad():
                expected = model.forward_raw(torch.from_numpy(packed), torch.from_numpy(lengths)).numpy()
            started = time.perf_counter()
            actual = session.run(["logits"], {"keypoints": packed, "lengths": lengths})[0]
            inference_ms = round((time.perf_counter() - started) * 1000)
            if actual.shape != (1, len(labels)) or not np.isfinite(actual).all():
                raise ValueError("Invalid model output")
            np.testing.assert_allclose(actual, expected, rtol=2e-4, atol=2e-4)
            ranking = np.argsort(-actual[0], kind="stable")
            top5 = [labels[index] for index in ranking[:5]]
            entry = {
                "file": path.name, "videoSha256": sha256(path), "expected": path.stem,
                "frames": length, "top5": top5, "top1Correct": top5[0] == path.stem,
                "top5Correct": path.stem in top5,
                "targetRank": int(np.flatnonzero(ranking == labels.index(path.stem))[0]) + 1,
                "maxAbsLogitError": float(np.max(np.abs(actual - expected))),
                "extractionMs": extraction_ms, "nativeOnnxInferenceMs": inference_ms,
                "landmarkCoverage": {
                    "pose": float(np.mean(raw[:, :13, 3] > 0)),
                    "leftHand": float(np.mean(raw[:, 13:34, 3] > 0)),
                    "rightHand": float(np.mean(raw[:, 34:55, 3] > 0)),
                    "face": float(np.mean(raw[:, 55:, 3] > 0)),
                },
            }
            results.append(entry)
            print(json.dumps(entry, ensure_ascii=False), flush=True)
    finally:
        extractor.close()
    result = {
        "datasetSource": dataset_source, "modelSha256": report["modelSha256"],
        "extractorSha256": EXTRACTOR_SHA256, "extractorBackend": backend,
        "taskAssetSha256": TASK_SHA256 if use_tasks else None,
        "versions": {"mediapipe": mp.__version__, "opencv": cv2.__version__,
                     "numpy": np.__version__, "torch": torch.__version__, "onnxruntime": ort.__version__},
        "sampling": "Source FPS stride round(fps/15), at most first 64 sampled frames; no mirror",
        "clips": results, "top1Count": sum(item["top1Correct"] for item in results),
        "top5Count": sum(item["top5Correct"] for item in results), "total": len(results),
        "limitations": "Small labelled-clip smoke test; no signer-independence, general accuracy, browser or live-camera claim",
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("exported", type=Path)
    parser.add_argument("videos", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--dataset-source", required=True)
    parser.add_argument("--tasks", action="store_true")
    args = parser.parse_args()
    evaluate(args.source, args.exported, args.videos, args.output, args.dataset_source, args.tasks)
