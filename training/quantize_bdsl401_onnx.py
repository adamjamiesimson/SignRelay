"""Compare a smaller Bangla research model with the verified float32 export.

Quantization is lossy: report prediction changes rather than asserting that its
logits equal float32. Generate separate references for cross-runtime checks.
"""
from __future__ import annotations

import argparse
from collections import Counter
import json
from pathlib import Path
import statistics
import time

from export_bdsl401_onnx import CLIPS, HASHES, digest, read_clip
from bdsl401_vocabulary import VOCABULARY, labels_for_codes


def summarize(logits, expected_code):
    import numpy as np
    if logits.shape != (1, 401) or not np.isfinite(logits).all():
        raise ValueError("Expected 401 finite classifier logits")
    order = np.argsort(-logits[0], kind="stable")
    top5 = [f"W{i + 1:03d}" for i in order[:5]]
    return {"top5": top5, "top1Correct": top5[0] == expected_code,
            "top5Correct": expected_code in top5}


def weight_only_graph(original: Path, quantized: Path, output: Path):
    """Reuse verified quantizer weights, but retain float32 activations/math."""
    import onnx
    graph = onnx.load(original)
    quant = onnx.load(quantized)
    original_weights = {value.name: value for value in graph.graph.initializer}
    quant_weights = {value.name: value for value in quant.graph.initializer}
    names = {node.input[1] for node in graph.graph.node
             if node.op_type == "MatMul" and node.input[1] in original_weights}
    additions, dequantizers = [], []
    used_names = {name for node in graph.graph.node for name in (*node.input, *node.output)}
    used_names.update(original_weights)
    for name in sorted(names):
        keys = [name + suffix for suffix in ("_quantized", "_scale", "_zero_point")]
        if any(key not in quant_weights or key in used_names for key in keys):
            raise ValueError(f"Unexpected quantized weight names for {name}")
        weight, scale, zero = [quant_weights[key] for key in keys]
        if (len(weight.dims) != 2 or list(weight.dims) != list(original_weights[name].dims)
                or list(scale.dims) != [weight.dims[1]] or list(zero.dims) != list(scale.dims)
                or weight.data_type != onnx.TensorProto.INT8 or zero.data_type != onnx.TensorProto.INT8):
            raise ValueError(f"Unexpected per-channel weight layout for {name}")
        additions.extend([weight, scale, zero])
        dequantizers.append(onnx.helper.make_node("DequantizeLinear", keys, [name], axis=1))
    if not names:
        raise ValueError("No constant MatMul weights found")
    retained = [value for value in graph.graph.initializer if value.name not in names]
    del graph.graph.initializer[:]
    graph.graph.initializer.extend(retained + additions)
    nodes = list(graph.graph.node)
    del graph.graph.node[:]
    graph.graph.node.extend(dequantizers + nodes)
    onnx.checker.check_model(graph)
    onnx.save(graph, output)


def compare(baseline: Path, clips: Path, output: Path, weight_only: bool = False):
    import numpy as np
    import onnx
    import onnxruntime as ort
    import torch
    from onnxruntime.quantization import QuantType, quantize_dynamic
    from onnxruntime.quantization.shape_inference import quant_pre_process

    output = output.resolve()
    project = Path(__file__).resolve().parents[1]
    if not output.is_relative_to(project / "work") or output == baseline.resolve():
        raise ValueError("Use a separate research directory under Git-ignored work/")
    reference = json.loads((baseline / "verification.json").read_text())
    original = baseline / "model.onnx"
    if reference["sourceHashes"] != HASHES or digest(original) != reference["modelSha256"]:
        raise ValueError("Baseline is not the verified pinned source export")
    if json.loads((baseline / "class-codes.json").read_text()) != [f"W{i:03d}" for i in range(1, 402)]:
        raise ValueError("Baseline class order mismatch")
    codes = json.loads((baseline / "class-codes.json").read_text())
    readable_labels = labels_for_codes(codes)
    for name, expected in CLIPS.items():
        if digest(clips / name) != expected:
            raise ValueError(f"Pinned clip mismatch: {name}")
    output.mkdir(parents=True, exist_ok=True)
    # Remove a previous success report before starting a new experiment.
    (output / "verification.json").unlink(missing_ok=True)
    prepared = output / "prepared.onnx"
    pending = output / "model.int8.pending.onnx"
    try:
        # Shape inference only; retain standard ONNX operations for WASM.
        quant_pre_process(original, prepared, skip_optimization=True, skip_symbolic_shape=True)
        quantize_dynamic(prepared, pending, op_types_to_quantize=["MatMul"],
                         per_channel=True, reduce_range=True, weight_type=QuantType.QInt8,
                         extra_options={"MatMulConstBOnly": True})
        if weight_only:
            weight_only_graph(original, pending, prepared)
            prepared.replace(pending)
        onnx.checker.check_model(str(pending))
        graph = onnx.load(pending)
        operators = dict(Counter(node.op_type for node in graph.graph.node))
        if operators.get("DequantizeLinear" if weight_only else "MatMulInteger", 0) == 0:
            raise ValueError("No matrix weights were quantized")
        del graph
        torch.set_num_threads(2)
        options = ort.SessionOptions()
        options.intra_op_num_threads = 2
        sessions = {
            "float32": ort.InferenceSession(str(original), options, providers=["CPUExecutionProvider"]),
            "int8": ort.InferenceSession(str(pending), options, providers=["CPUExecutionProvider"]),
        }
        first, _ = read_clip(clips / next(iter(CLIPS)))
        for session in sessions.values():
            session.run(["logits"], {"pixel_values": first})  # one untimed warm-up
        results = []
        fixture_dir = output / "fixtures"
        fixture_dir.mkdir(exist_ok=True)
        for name in CLIPS:
            inputs, source_frames = read_clip(clips / name)
            entry = {"file": name, "sha256": CLIPS[name], "expectedCode": name[:4],
                     "sourceFrames": source_frames, "variants": {}, "fixtures": {}}
            arrays = {}
            for variant, session in sessions.items():
                started = time.perf_counter()
                logits = session.run(["logits"], {"pixel_values": inputs})[0]
                elapsed = (time.perf_counter() - started) * 1000
                entry["variants"][variant] = {**summarize(logits, name[:4]), "nativeInferenceMs": round(elapsed)}
                arrays[variant] = logits
            entry["top1Unchanged"] = entry["variants"]["float32"]["top5"][0] == entry["variants"]["int8"]["top5"][0]
            entry["maxAbsLogitChange"] = float(np.max(np.abs(arrays["float32"] - arrays["int8"])))
            entry["meanAbsLogitChange"] = float(np.mean(np.abs(arrays["float32"] - arrays["int8"])))
            for kind, values in {"input": inputs, **arrays}.items():
                path = fixture_dir / f"{Path(name).stem}-{kind}.f32"
                values.astype("<f4").tofile(path)
                entry["fixtures"][kind] = {"path": str(path.relative_to(output)), "sha256": digest(path)}
            print(json.dumps({key: value for key, value in entry.items() if key != "fixtures"}), flush=True)
            results.append(entry)
        del sessions
        model = output / "model.int8.onnx"
        pending.replace(model)
        (output / "class-codes.json").write_text(json.dumps(codes, indent=2) + "\n")
        (output / "labels.json").write_text(json.dumps(readable_labels, ensure_ascii=False, indent=2) + "\n")
        variants = {}
        for variant, path in {"float32": original, "int8": model}.items():
            variants[variant] = {"modelSha256": digest(path), "modelBytes": path.stat().st_size,
                                 "top1Count": sum(row["variants"][variant]["top1Correct"] for row in results),
                                 "top5Count": sum(row["variants"][variant]["top5Correct"] for row in results),
                                 "nativeMedianInferenceMs": statistics.median(row["variants"][variant]["nativeInferenceMs"] for row in results)}
        report = {"source": reference["source"], "sourceHashes": HASHES,
                  "clipSource": reference["clipSource"], "selection": reference["selection"],
                  "mode": "weight-only" if weight_only else "dynamic",
                  "method": ("Constant MatMul weights stored as per-channel signed int8 with reduced 7-bit range, then DequantizeLinear on axis 1; float32 activations and arithmetic; Conv and classifier Gemm remain float32" if weight_only else "Dynamic MatMul constant weights only; per-channel signed int8 storage with reduced 7-bit range; uint8 activations; Conv and attention products remain float32"),
                  "preprocessing": reference["preprocessing"], "input": [1, 16, 3, 224, 224], "output": [1, 401],
                  "variants": variants, "quantizedOperators": operators, "clips": results, "total": len(results),
                  "top1UnchangedCount": sum(row["top1Unchanged"] for row in results),
                  "sizeReductionPercent": round(100 * (1 - model.stat().st_size / original.stat().st_size), 2),
                  "versions": {"onnx": onnx.__version__, "onnxruntime": ort.__version__, "torch": torch.__version__},
                  "timing": "Two native CPU threads; one untimed warm-up then one timed inference per clip and variant on the same host",
                  "installed": False, "readableVocabularyVerified": True, "browserTested": False,
                  "vocabularySha256": digest(VOCABULARY), "distinctEnglishLabels": len(set(readable_labels)),
                  "limitations": "Six publisher-selected coded examples; no independent accuracy estimate. Quantization changes logits. Native and WASM equivalence must use the matching variant reference. No activation or deployment."}
        (output / "verification.json").write_text(json.dumps(report, indent=2) + "\n")
        return report
    finally:
        prepared.unlink(missing_ok=True)
        pending.unlink(missing_ok=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("baseline", type=Path)
    parser.add_argument("clips", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--weight-only", action="store_true", help="Keep activations/arithmetic float32; use a separate output directory")
    args = parser.parse_args()
    output = args.output or Path("work/bdsl401-weight-only" if args.weight_only else "work/bdsl401-int8")
    compare(args.baseline, args.clips, output, args.weight_only)
