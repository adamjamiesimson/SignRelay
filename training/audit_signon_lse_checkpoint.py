"""Inspect the real Spanish classifier head without executing pickled objects."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from export_ksl_onnx import sha256

REPO = "signon-project/slr-poseformer-lse"
REVISION = "9078e2ae57678c48d20e7e599a45657414bea22b"
CHECKPOINT_SHA256 = "2c6594440b6a23b86dd432395dbdc91c9876893625f0dce42b5a49de1ec9afd2"


def audit(path: Path) -> dict:
    import torch
    if sha256(path) != CHECKPOINT_SHA256:
        raise ValueError("Unexpected SignON Spanish checkpoint checksum")
    checkpoint = torch.load(path, map_location="cpu", weights_only=True)
    weight = checkpoint["state_dict"]["model.head.weight"]
    bias = checkpoint["state_dict"]["model.head.bias"]
    classes = checkpoint["hyper_parameters"]["num_classes"]
    if weight.ndim != 2 or tuple(bias.shape) != (weight.shape[0],) or classes != [weight.shape[0]]:
        raise ValueError("Classifier head does not match checkpoint configuration")
    return {
        "source": f"https://huggingface.co/{REPO}/tree/{REVISION}",
        "checkpointSha256": CHECKPOINT_SHA256,
        "checkpointBytes": path.stat().st_size,
        "inspection": "torch.load(weights_only=True), no custom safe globals",
        "headWeightShape": list(weight.shape), "headBiasShape": list(bias.shape),
        "recognitionClasses": weight.shape[0], "requiredClasses": 400,
        "meetsVocabularyThreshold": weight.shape[0] >= 400,
        "activationApproved": False,
        "reason": "The trained head has 35 outputs. Its 192-dimensional embedding is not a recognition vocabulary.",
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("checkpoint", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = audit(args.checkpoint)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))
    raise SystemExit(0 if result["meetsVocabularyThreshold"] else 1)
