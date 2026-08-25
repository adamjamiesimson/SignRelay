"""Export the official WLASL Pose-TGCN checkpoint for local browser inference.

The WLASL authors publish this checkpoint and its OpenPose training inputs under
the WLASL C-UDA. This exporter deliberately uses a restricted legacy-checkpoint
reader: it reconstructs only tensors and never imports or executes pickle
globals from the checkpoint.
"""

from __future__ import annotations

import argparse
import collections
import gzip
import hashlib
import json
import math
import pickle
import struct
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO

import numpy as np


MAGIC_NUMBER = 0x1950A86A20F9469CFC6C
PROTOCOL_VERSION = 1001
BN_EPSILON = 1e-5


@dataclass(frozen=True)
class StorageRef:
    key: str
    size: int
    dtype: str


@dataclass(frozen=True)
class TensorRef:
    storage: StorageRef
    offset: int
    shape: tuple[int, ...]
    stride: tuple[int, ...]


def rebuild_tensor(storage: StorageRef, offset: int, size: tuple[int, ...], stride: tuple[int, ...], *_: object) -> TensorRef:
    return TensorRef(storage, int(offset), tuple(size), tuple(stride))


STORAGE_DTYPES = {
    "FloatStorage": "float32",
    "DoubleStorage": "float64",
    "HalfStorage": "float16",
    "LongStorage": "int64",
    "IntStorage": "int32",
    "ShortStorage": "int16",
    "CharStorage": "int8",
    "ByteStorage": "uint8",
    "BoolStorage": "bool",
}


class RestrictedTorchUnpickler(pickle.Unpickler):
    """Allow only the inert globals needed by a legacy tensor state_dict."""

    def find_class(self, module: str, name: str) -> object:
        allowed = {
            ("collections", "OrderedDict"): collections.OrderedDict,
            ("torch._utils", "_rebuild_tensor_v2"): rebuild_tensor,
            ("torch._utils", "_rebuild_tensor"): rebuild_tensor,
        }
        if (module, name) in allowed:
            return allowed[(module, name)]
        if module == "torch" and name in STORAGE_DTYPES:
            return type(name, (), {"dtype": STORAGE_DTYPES[name]})
        raise pickle.UnpicklingError(f"Blocked checkpoint global: {module}.{name}")

    def persistent_load(self, saved_id: object) -> StorageRef:
        if not isinstance(saved_id, tuple) or len(saved_id) < 5 or saved_id[0] != "storage":
            raise pickle.UnpicklingError("Blocked non-storage persistent checkpoint object")
        _, storage_type, key, _location, size, *_ = saved_id
        dtype = getattr(storage_type, "dtype", None)
        if dtype not in set(STORAGE_DTYPES.values()):
            raise pickle.UnpicklingError(f"Blocked storage dtype: {dtype}")
        return StorageRef(str(key), int(size), str(dtype))


def restricted_load(handle: BinaryIO) -> object:
    return RestrictedTorchUnpickler(handle).load()


def read_legacy_state_dict(path: Path) -> collections.OrderedDict[str, np.ndarray]:
    with path.open("rb") as handle:
        magic = restricted_load(handle)
        protocol = restricted_load(handle)
        _system_info = restricted_load(handle)
        tensor_refs = restricted_load(handle)
        storage_keys = restricted_load(handle)
        if magic != MAGIC_NUMBER or protocol != PROTOCOL_VERSION:
            raise ValueError("Checkpoint is not the expected legacy PyTorch tensor format")
        if not isinstance(tensor_refs, collections.OrderedDict) or not isinstance(storage_keys, list):
            raise ValueError("Checkpoint does not contain a tensor state_dict")

        refs_by_storage: dict[str, StorageRef] = {}
        for ref in tensor_refs.values():
            if not isinstance(ref, TensorRef):
                raise ValueError("Checkpoint contains a non-tensor state entry")
            refs_by_storage[ref.storage.key] = ref.storage

        storages: dict[str, np.ndarray] = {}
        for key in storage_keys:
            key = str(key)
            ref = refs_by_storage.get(key)
            if ref is None:
                raise ValueError(f"Unreferenced storage {key}")
            count_bytes = handle.read(8)
            if len(count_bytes) != 8:
                raise ValueError("Checkpoint ended before its tensor data")
            count = struct.unpack("<Q", count_bytes)[0]
            if count != ref.size:
                raise ValueError(f"Storage {key} has {count} values; expected {ref.size}")
            dtype = np.dtype(ref.dtype).newbyteorder("<")
            payload = handle.read(count * dtype.itemsize)
            if len(payload) != count * dtype.itemsize:
                raise ValueError(f"Storage {key} is truncated")
            storages[key] = np.frombuffer(payload, dtype=dtype).copy()

    state: collections.OrderedDict[str, np.ndarray] = collections.OrderedDict()
    for name, ref in tensor_refs.items():
        base = storages[ref.storage.key]
        if not ref.shape:
            state[name] = base[ref.offset:ref.offset + 1].reshape(())
            continue
        view = np.lib.stride_tricks.as_strided(
            base[ref.offset:],
            shape=ref.shape,
            strides=tuple(step * base.dtype.itemsize for step in ref.stride),
        )
        state[name] = np.array(view, copy=True)
    return state


class BinaryPacker:
    def __init__(self) -> None:
        self.payload = bytearray()

    def add(self, values: np.ndarray, dtype: str) -> dict[str, object]:
        array = np.ascontiguousarray(values, dtype=np.dtype(dtype).newbyteorder("<"))
        alignment = max(1, array.dtype.itemsize)
        while len(self.payload) % alignment:
            self.payload.append(0)
        descriptor = {
            "offset": len(self.payload),
            "length": int(array.size),
            "shape": list(array.shape),
            "dtype": {"int8": "i8", "float16": "f16", "float32": "f32"}[array.dtype.name],
        }
        self.payload.extend(array.tobytes(order="C"))
        return descriptor


def quantise_columns(values: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    scales = np.max(np.abs(values), axis=0).astype(np.float32) / 127.0
    scales[scales == 0] = 1.0
    quantised = np.clip(np.rint(values / scales), -127, 127).astype(np.int8)
    return quantised, scales


def quantise_rows(values: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    scales = np.max(np.abs(values), axis=1).astype(np.float32) / 127.0
    scales[scales == 0] = 1.0
    quantised = np.clip(np.rint(values / scales[:, None]), -127, 127).astype(np.int8)
    return quantised, scales


def export_graph_layer(state: dict[str, np.ndarray], prefix: str, bn_prefix: str, packer: BinaryPacker, residual: bool) -> dict[str, object]:
    weight = state[f"{prefix}.weight"].astype(np.float32)
    attention = state[f"{prefix}.att"].astype(np.float32)
    bias = state[f"{prefix}.bias"].astype(np.float32)
    gamma = state[f"{bn_prefix}.weight"].astype(np.float32)
    beta = state[f"{bn_prefix}.bias"].astype(np.float32)
    mean = state[f"{bn_prefix}.running_mean"].astype(np.float32)
    variance = state[f"{bn_prefix}.running_var"].astype(np.float32)

    output_features = weight.shape[1]
    nodes = attention.shape[0]
    if gamma.shape != (nodes * output_features,):
        raise ValueError(f"Unexpected batch-normalisation shape for {prefix}")
    normal_scale = gamma / np.sqrt(variance + BN_EPSILON)
    repeated_bias = np.tile(bias, nodes)
    normal_shift = beta + (repeated_bias - mean) * normal_scale
    q_weight, weight_scales = quantise_columns(weight)
    q_attention, attention_scales = quantise_rows(attention)

    return {
        "inputFeatures": int(weight.shape[0]),
        "outputFeatures": int(output_features),
        "residual": residual,
        "weight": packer.add(q_weight, "int8"),
        "weightScales": packer.add(weight_scales, "float32"),
        "attention": packer.add(q_attention, "int8"),
        "attentionScales": packer.add(attention_scales, "float32"),
        "normalScale": packer.add(normal_scale.astype(np.float16), "float16"),
        "normalShift": packer.add(normal_shift.astype(np.float16), "float16"),
    }


def dequantise_columns(values: np.ndarray, scales: np.ndarray) -> np.ndarray:
    return values.astype(np.float32) * scales[None, :]


def dequantise_rows(values: np.ndarray, scales: np.ndarray) -> np.ndarray:
    return values.astype(np.float32) * scales[:, None]


def original_layer(state: dict[str, np.ndarray], prefix: str, bn_prefix: str, x: np.ndarray) -> np.ndarray:
    y = state[f"{prefix}.att"] @ (x @ state[f"{prefix}.weight"]) + state[f"{prefix}.bias"]
    shape = y.shape
    flat = y.reshape(*shape[:-2], -1)
    flat = (
        (flat - state[f"{bn_prefix}.running_mean"])
        / np.sqrt(state[f"{bn_prefix}.running_var"] + BN_EPSILON)
        * state[f"{bn_prefix}.weight"]
        + state[f"{bn_prefix}.bias"]
    )
    return np.tanh(flat.reshape(shape))


def quantised_layer(state: dict[str, np.ndarray], prefix: str, bn_prefix: str, x: np.ndarray) -> np.ndarray:
    weight = state[f"{prefix}.weight"].astype(np.float32)
    attention = state[f"{prefix}.att"].astype(np.float32)
    bias = state[f"{prefix}.bias"].astype(np.float32)
    q_weight, weight_scales = quantise_columns(weight)
    q_attention, attention_scales = quantise_rows(attention)
    gamma = state[f"{bn_prefix}.weight"].astype(np.float32)
    beta = state[f"{bn_prefix}.bias"].astype(np.float32)
    mean = state[f"{bn_prefix}.running_mean"].astype(np.float32)
    variance = state[f"{bn_prefix}.running_var"].astype(np.float32)
    normal_scale = (gamma / np.sqrt(variance + BN_EPSILON)).astype(np.float16).astype(np.float32)
    normal_shift = (beta + (np.tile(bias, attention.shape[0]) - mean) * (gamma / np.sqrt(variance + BN_EPSILON))).astype(np.float16).astype(np.float32)
    y = dequantise_rows(q_attention, attention_scales) @ (x @ dequantise_columns(q_weight, weight_scales))
    return np.tanh((y.reshape(*y.shape[:-2], -1) * normal_scale + normal_shift).reshape(y.shape))


def infer(state: dict[str, np.ndarray], x: np.ndarray, quantised: bool) -> np.ndarray:
    layer = quantised_layer if quantised else original_layer
    x = layer(state, "gc1", "bn1", x)
    for stage in range(24):
        residual = x
        x = layer(state, f"gcbs.{stage}.gc1", f"gcbs.{stage}.bn1", x)
        x = layer(state, f"gcbs.{stage}.gc2", f"gcbs.{stage}.bn2", x) + residual
    pooled = x.mean(axis=-2)
    weight = state["fc_out.weight"].astype(np.float32)
    bias = state["fc_out.bias"].astype(np.float32)
    if quantised:
        q_weight, scales = quantise_rows(weight)
        weight = dequantise_rows(q_weight, scales)
        bias = bias.astype(np.float16).astype(np.float32)
    return pooled @ weight.T + bias


def main() -> None:
    parser = argparse.ArgumentParser(description="Export official WLASL1000 Pose-TGCN weights for SignRelay")
    parser.add_argument("checkpoint", type=Path)
    parser.add_argument("split", type=Path, help="Official WLASL asl1000.json split")
    parser.add_argument("--output", type=Path, default=Path("public/models/asl1000-tgcn"))
    parser.add_argument("--verify-random", type=int, default=3)
    parser.add_argument("--spotcheck-report", type=Path, help="Optional report from evaluate_wlasl1000_tgcn.py")
    args = parser.parse_args()

    state = read_legacy_state_dict(args.checkpoint)
    entries = json.loads(args.split.read_text(encoding="utf-8"))
    labels = sorted(str(entry["gloss"]).strip().upper() for entry in entries)
    if len(labels) != 1000 or len(set(labels)) != 1000:
        raise ValueError("Expected the official 1,000-class WLASL split")

    packer = BinaryPacker()
    layers = [export_graph_layer(state, "gc1", "bn1", packer, False)]
    for stage in range(24):
        layers.append(export_graph_layer(state, f"gcbs.{stage}.gc1", f"gcbs.{stage}.bn1", packer, False))
        layers.append(export_graph_layer(state, f"gcbs.{stage}.gc2", f"gcbs.{stage}.bn2", packer, True))

    fc_weight = state["fc_out.weight"].astype(np.float32)
    fc_bias = state["fc_out.bias"].astype(np.float32)
    q_fc_weight, fc_scales = quantise_rows(fc_weight)
    classifier = {
        "inputFeatures": int(fc_weight.shape[1]),
        "outputFeatures": int(fc_weight.shape[0]),
        "weight": packer.add(q_fc_weight, "int8"),
        "weightScales": packer.add(fc_scales, "float32"),
        "bias": packer.add(fc_bias.astype(np.float16), "float16"),
    }

    args.output.mkdir(parents=True, exist_ok=True)
    binary = bytes(packer.payload)
    compressed = gzip.compress(binary, compresslevel=9, mtime=0)
    binary_path = args.output / "model.bin.gz"
    binary_path.write_bytes(compressed)
    (args.output / "labels.json").write_text(json.dumps(labels, indent=2), encoding="utf-8")

    manifest = {
        "format": "signrelay-tgcn-v1",
        "modelVersion": "wlasl1000-pose-tgcn-official-quantised-v1",
        "language": "ASL",
        "classes": 1000,
        "nodes": 55,
        "sequenceLength": 50,
        "inputFeatures": 100,
        "hiddenFeatures": 256,
        "stages": 24,
        "layers": layers,
        "classifier": classifier,
        "binaryBytes": len(binary),
        "compressedBytes": len(compressed),
        "binarySha256": hashlib.sha256(binary).hexdigest(),
        "compressedSha256": hashlib.sha256(compressed).hexdigest(),
        "source": {
            "dataset": "WLASL1000",
            "architecture": "Pose-TGCN",
            "publisher": "Official WLASL authors",
            "usage": "Academic and computational use only; no commercial use",
        },
        "quantisation": "Per-output symmetric int8 graph/classifier weights; float16 fused batch normalisation",
    }
    (args.output / "model.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    rng = np.random.default_rng(20260825)
    agreements = 0
    max_logit_error = 0.0
    for _ in range(args.verify_random):
        sample = rng.normal(0, 0.35, size=(55, 100)).astype(np.float32)
        original = infer(state, sample, quantised=False)
        packed = infer(state, sample, quantised=True)
        agreements += int(int(original.argmax()) == int(packed.argmax()))
        max_logit_error = max(max_logit_error, float(np.max(np.abs(original - packed))))
    quantisation_report = {
        "random_inputs": args.verify_random,
        "top1_agreement": agreements / max(args.verify_random, 1),
        "maximum_logit_error": max_logit_error,
    }
    (args.output / "adapter.json").write_text(json.dumps({
        "language": "ASL",
        "model": manifest["modelVersion"],
        "input": "50 frames x (13 OpenPose upper-body + 21 left-hand + 21 right-hand) x 2D",
        "liveAdapter": "MediaPipe 33-point pose and two 21-point hands mapped to the OpenPose 55-node contract",
        "confidenceThreshold": 0.62,
        "marginThreshold": 0.22,
        "segmentation": "Completed-motion gate before closed-set classification",
        "privacy": "Inference runs locally; model input is landmarks, not uploaded camera video",
    }, indent=2), encoding="utf-8")
    metrics = {
        "publishedHeldOutBenchmark": {
            "dataset": "WLASL1000",
            "input": "Official OpenPose sequences",
            "top1": 0.3486,
            "top5": 0.6173,
            "top10": 0.7191,
            "source": "Li et al., WACV 2020, Table 3",
        },
        "exportVerification": quantisation_report,
        "liveMediaPipeAccuracy": None,
        "warning": "The live MediaPipe-to-OpenPose adapter is a domain change and needs a separate signer-independent benchmark.",
    }
    if args.spotcheck_report:
        spotcheck = json.loads(args.spotcheck_report.read_text(encoding="utf-8"))
        metrics["localOfficialPoseSpotCheck"] = {
            "sampleCount": spotcheck["sample_count"],
            "top1": spotcheck["top1"],
            "top5": spotcheck["top5"],
            "quantisedTop1Agreement": spotcheck["quantised_top1_agreement"],
            "note": "Small deterministic audit sample; not a replacement for the published full-test benchmark.",
        }
    (args.output / "metrics.json").write_text(json.dumps(metrics, indent=2), encoding="utf-8")
    (args.output / "dataset-card.md").write_text(
        "# WLASL1000 Pose-TGCN browser model\n\n"
        "This is a quantised browser export of the official WLASL1000 Pose-TGCN checkpoint published by the WLASL authors. "
        "It recognises isolated signs from 55 two-dimensional body-and-hand points across 50 temporal samples.\n\n"
        "- Dataset and checkpoint: https://github.com/dxli94/WLASL\n"
        "- Paper: https://arxiv.org/abs/1910.11006\n"
        "- Published WLASL1000 Pose-TGCN benchmark: 34.86% top-1, 61.73% top-5, 71.91% top-10.\n"
        "- Terms: academic and computational use only; commercial use is not allowed.\n"
        "- Privacy: raw WLASL videos and pose training samples are not included in the website. Live camera inference stays in the browser.\n\n"
        "The live adapter maps MediaPipe landmarks to the OpenPose training contract. That domain change, the closed-set rejection gate, "
        "and real webcam conditions require separate evaluation, so SignRelay labels the feature experimental.\n",
        encoding="utf-8",
    )
    hash_files = ["model.bin.gz", "model.json", "labels.json", "adapter.json", "metrics.json", "dataset-card.md"]
    (args.output / "sha256.txt").write_text("".join(
        f"{hashlib.sha256((args.output / name).read_bytes()).hexdigest()}  {name}\n"
        for name in hash_files
    ), encoding="utf-8")
    print(json.dumps({
        "labels": len(labels),
        "layers": len(layers),
        "raw_bytes": len(binary),
        "compressed_bytes": len(compressed),
        "random_top1_agreement": quantisation_report["top1_agreement"],
        "max_random_logit_error": max_logit_error,
        "output": str(args.output),
    }, indent=2))


if __name__ == "__main__":
    main()
