"""Export SignRelay's shipped packed ASL-2000 Pose-TGCN to ONNX (experiment).

The ONNX graph stores exactly the shipped int8 weights and float16 fused
normalisation and dequantises them in-graph (Cast and Mul by the shipped
per-channel scales; Cast for float16), so ONNX Runtime folds them into the
same float32 values the JS runtime uses. No retraining, no re-quantisation.
It exists to measure a faster execution backend (ONNX Runtime Web WASM/SIMD) against the scalar JS
runtime on identical inputs; it is not wired into the app by this script.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper

sys.path.insert(0, str(Path(__file__).resolve().parent))
from tgcn_packed import PackedTgcn  # noqa: E402


def export(root: Path, output: Path, batch: int | None = None) -> None:
    import gzip
    import json
    manifest = json.loads((root / "model.json").read_text(encoding="utf-8"))
    binary = gzip.decompress(b"".join((root / name).read_bytes() for name in manifest["binaryParts"]))
    nodes, initialisers = [], []

    def raw(descriptor: dict, dtype) -> np.ndarray:
        return np.frombuffer(binary, dtype=np.dtype(dtype).newbyteorder("<"), count=descriptor["length"],
                             offset=descriptor["offset"]).reshape(descriptor["shape"])

    def add(name: str, value: np.ndarray) -> str:
        initialisers.append(numpy_helper.from_array(np.ascontiguousarray(value), name))
        return name

    def dequantised(name: str, values: dict, scales: dict, shape: tuple[int, ...], axis: int) -> str:
        # Cast + Mul rather than DequantizeLinear: QDQ patterns let ONNX Runtime
        # fuse into integer matmuls that also quantise activations.
        add(f"{name}_q", raw(values, np.int8).reshape(shape))
        scale = raw(scales, np.float32)
        add(f"{name}_scale", scale.reshape((1, -1) if axis == 1 else (-1, 1)))
        nodes.append(helper.make_node("Cast", [f"{name}_q"], [f"{name}_f32"], to=TensorProto.FLOAT))
        nodes.append(helper.make_node("Mul", [f"{name}_f32", f"{name}_scale"], [name]))
        return name

    def half(name: str, values: dict, shape: tuple[int, ...]) -> str:
        add(f"{name}_f16", raw(values, np.float16).reshape(shape))
        nodes.append(helper.make_node("Cast", [f"{name}_f16"], [name], to=TensorProto.FLOAT))
        return name

    nodes_count = manifest["nodes"]

    current, pending = "input", None
    layers = manifest["layers"]
    for index, layer in enumerate(layers):
        following = layers[index + 1] if index + 1 < len(layers) else None
        if not layer["residual"] and following is not None and following["residual"]:
            pending = current
        features = (layer["inputFeatures"], layer["outputFeatures"])
        w = dequantised(f"w{index}", layer["weight"], layer["weightScales"], features, 1)
        a = dequantised(f"a{index}", layer["attention"], layer["attentionScales"], (nodes_count, nodes_count), 0)
        s = half(f"s{index}", layer["normalScale"], (nodes_count, layer["outputFeatures"]))
        b = half(f"b{index}", layer["normalShift"], (nodes_count, layer["outputFeatures"]))
        nodes += [
            helper.make_node("MatMul", [current, w], [f"xw{index}"]),
            helper.make_node("MatMul", [a, f"xw{index}"], [f"axw{index}"]),
            helper.make_node("Mul", [f"axw{index}", s], [f"m{index}"]),
            helper.make_node("Add", [f"m{index}", b], [f"n{index}"]),
            helper.make_node("Tanh", [f"n{index}"], [f"t{index}"]),
        ]
        current = f"t{index}"
        if layer["residual"] and pending is not None:
            nodes.append(helper.make_node("Add", [current, pending], [f"r{index}"]))
            current, pending = f"r{index}", None
    classifier = manifest["classifier"]
    add("axes", np.array([1], dtype=np.int64))
    dequantised("classifier", classifier["weight"], classifier["weightScales"], (classifier["outputFeatures"], classifier["inputFeatures"]), 0)
    half("bias", classifier["bias"], (classifier["outputFeatures"],))
    nodes += [
        helper.make_node("ReduceMean", [current, "axes"], ["pooled"], keepdims=0),
        helper.make_node("Gemm", ["pooled", "classifier", "bias"], ["logits"], transB=1),
    ]
    graph = helper.make_graph(nodes, "signrelay_asl2000_tgcn",
                              [helper.make_tensor_value_info("input", TensorProto.FLOAT, [batch or "batch", 55, 100])],
                              [helper.make_tensor_value_info("logits", TensorProto.FLOAT, [batch or "batch", classifier["outputFeatures"]])],
                              initialisers)
    proto = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 18)], producer_name="signrelay")
    proto.ir_version = 9
    onnx.checker.check_model(proto)
    onnx.save(proto, output)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", type=Path, default=Path("public/models/asl2000-tgcn"))
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    export(args.model, args.output)
    model = PackedTgcn(args.model)
    import onnxruntime
    session = onnxruntime.InferenceSession(str(args.output), providers=["CPUExecutionProvider"])
    inputs = np.random.default_rng(20261030).normal(0, 0.4, (16, 55, 100)).astype(np.float32)
    inputs[:4, 13:] = -1.0  # include hands-absent inputs
    produced = session.run(None, {"input": inputs})[0]
    reference = model.logits(inputs)
    print({"bytes": args.output.stat().st_size, "max_abs_logit_vs_packed_replica": float(np.abs(produced - reference).max()),
           "top1_agreement": float((produced.argmax(1) == reference.argmax(1)).mean())})


if __name__ == "__main__":
    main()
