"""NumPy replica of SignRelay's shipped packed ASL-2000 Pose-TGCN.

Reads exactly the browser files (model.json, model.partNN.bin, labels.json)
and dequantises them the way lib/asl1000-runtime.ts does. Batched float32
matrix products make large evaluations practical; the JS runtime itself is run
on a parity subset (scripts/asl2000-eval/infer.ts) to confirm agreement.
"""

from __future__ import annotations

import gzip
import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np

PRODUCTION_MIN_CONFIDENCE = 0.62
PRODUCTION_MIN_MARGIN = 0.22


def _view(binary: bytes, descriptor: dict) -> np.ndarray:
    dtype = {"i8": np.int8, "f16": np.float16, "f32": np.float32}[descriptor["dtype"]]
    values = np.frombuffer(binary, dtype=np.dtype(dtype).newbyteorder("<"), count=descriptor["length"], offset=descriptor["offset"])
    return values.astype(np.float32).reshape(descriptor["shape"])


@dataclass
class Layer:
    weight: np.ndarray
    attention: np.ndarray
    scale: np.ndarray
    shift: np.ndarray
    residual: bool


class PackedTgcn:
    def __init__(self, root: Path) -> None:
        manifest = json.loads((root / "model.json").read_text(encoding="utf-8"))
        self.labels: list[str] = json.loads((root / "labels.json").read_text(encoding="utf-8"))
        compressed = b"".join((root / name).read_bytes() for name in manifest["binaryParts"])
        binary = gzip.decompress(compressed)
        if len(binary) != manifest["binaryBytes"]:
            raise ValueError("Packed model integrity check failed")
        self.nodes = manifest["nodes"]
        self.layers: list[Layer] = []
        for layer in manifest["layers"]:
            outputs = layer["outputFeatures"]
            weight = _view(binary, layer["weight"]).reshape(layer["inputFeatures"], outputs) * _view(binary, layer["weightScales"])[None, :]
            attention = _view(binary, layer["attention"]).reshape(self.nodes, self.nodes) * _view(binary, layer["attentionScales"])[:, None]
            self.layers.append(Layer(
                weight=weight.astype(np.float32), attention=attention.astype(np.float32),
                scale=_view(binary, layer["normalScale"]).reshape(self.nodes, outputs),
                shift=_view(binary, layer["normalShift"]).reshape(self.nodes, outputs),
                residual=bool(layer["residual"]),
            ))
        classifier = manifest["classifier"]
        self.classifier = (_view(binary, classifier["weight"]).reshape(classifier["outputFeatures"], classifier["inputFeatures"])
                           * _view(binary, classifier["weightScales"])[:, None]).astype(np.float32)
        self.bias = _view(binary, classifier["bias"])

    def logits(self, inputs: np.ndarray) -> np.ndarray:
        """inputs: (batch, 55, 100) float32 -> (batch, classes)."""
        x = np.asarray(inputs, dtype=np.float32)
        pending = None
        for index, layer in enumerate(self.layers):
            following = self.layers[index + 1] if index + 1 < len(self.layers) else None
            if not layer.residual and following is not None and following.residual:
                pending = x
            y = np.tanh((layer.attention @ (x @ layer.weight)) * layer.scale + layer.shift)
            if layer.residual and pending is not None:
                y = y + pending
                pending = None
            x = y.astype(np.float32)
        return x.mean(axis=1) @ self.classifier.T + self.bias


def softmax(logits: np.ndarray) -> np.ndarray:
    shifted = logits - logits.max(axis=-1, keepdims=True)
    values = np.exp(shifted)
    return values / values.sum(axis=-1, keepdims=True)


def decide(mean_logits: np.ndarray, labels: list[str], target: int | None = None) -> dict:
    """The production decideAsl2000 gate plus diagnostic ranks."""
    probabilities = softmax(mean_logits.astype(np.float64))
    order = np.argsort(-probabilities, kind="stable")
    best, runner_up = int(order[0]), int(order[1])
    confidence = float(probabilities[best])
    margin = confidence - float(probabilities[runner_up])
    record = {
        "top5": [[labels[int(i)], round(float(probabilities[int(i)]), 4)] for i in order[:5]],
        "prediction": labels[best],
        "confidence": confidence,
        "margin": margin,
        "accepted": confidence >= PRODUCTION_MIN_CONFIDENCE and margin >= PRODUCTION_MIN_MARGIN,
    }
    if target is not None:
        record["rank"] = int(np.nonzero(order == target)[0][0]) + 1
        record["target_probability"] = float(probabilities[target])
    return record
