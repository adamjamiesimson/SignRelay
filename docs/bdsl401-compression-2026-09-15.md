# Bangla compression experiment — 15 September 2026

This experiment reduces the storage and runtime cost of the pinned 401-class Bangla VideoMAE research candidate. Bangla remains inactive: a verified readable word map is missing, and these tests do not establish live or independent recognition accuracy.

## Source and method

The original checkpoint, preprocessing and six publisher-selected clips are the same as the [verified conversion](pretrained-expansion-2026-09-15.md). Re-exporting reproduced the original ONNX SHA-256 exactly: `840f6862f3988616fda45ac06704ed4be1e0378e59460abd7b4ce18d3634ce73`. All six float32 native outputs again passed comparison with PyTorch.

`training/fetch_bdsl401_research_assets.py` now downloads and hashes the exact four source files and six clips. Verified files are cached, incomplete transfers use a temporary file, and corrupt downloads cannot replace an existing file. Assets stay under Git-ignored `work/`.

Two compression modes are implemented in `training/quantize_bdsl401_onnx.py`:

- **Dynamic:** ONNX Runtime quantizes constant MatMul weights with per-channel signed int8 storage and reduced 7-bit range. Activations are dynamically quantized to uint8. Convolution and attention matrix products remain float32.
- **Weight-only:** the same quantized weights from 72 original MatMul operations are dequantized with `DequantizeLinear`, retaining float32 activations and arithmetic. The convolution and classifier Gemm remain float32.

The reduced range follows the [ONNX Runtime guidance for per-channel U8S8 quantization](https://onnxruntime.ai/docs/performance/model-optimizations/quantization.html). Quantization changes the model's scores; it is not a lossless export. No calibration or training was performed on these examples.

## Dynamic quantization: smaller and faster, numerical gate failed

The dynamic model is **95,983,043 bytes**, down from 351,137,555 bytes (**72.67% smaller**). Native CPU median inference fell from 2,251 ms to 1,100 ms in the paired six-clip run. All six first-choice predictions were preserved; both models scored 4/6 top-1 and 6/6 top-5 against the filename class codes.

In single-thread WASM, all six clips exceeded the unchanged numerical tolerance of `absolute=0.0002, relative=0.0002` against this exact dynamic model's native outputs. Maximum per-clip absolute logit differences ranged from about 0.294 to 0.385. First-choice predictions still matched native on all six clips, but the ordered top-five predictions matched on only four. The benchmark exits with failure and retains the complete measurements; the tolerance was not relaxed.

A check of the first clip with native ONNX Runtime 1.23.2 produced exactly the same logits as native 1.20.1. A version-only explanation therefore does not resolve this observed discrepancy. The precise kernel-level cause remains unverified.

## Weight-only compression: cross-runtime gate passed

The weight-only model is **96,764,338 bytes**, a **72.44% reduction**. All six first-choice predictions were preserved versus float32. Recognition on the six publisher examples remained 4/6 top-1 and 6/6 top-5. Quantization still changes scores and some lower-ranked predictions compared with float32.

All six clips passed native-versus-WASM numerical comparison for the weight-only model, and all six ordered top-five lists agreed with its native references. The maximum absolute cross-runtime logit difference was **0.000009537**. This checks execution consistency; it does not establish recognition accuracy.

| Variant | Model size (MB) | WASM median inference | Peak Node RSS (MiB) | Numerical parity |
| --- | ---: | ---: | ---: | --- |
| Float32 | 351.14 | 14.26 s | 1360.8 | Passed 6/6 |
| Dynamic int8 | 95.98 | 8.42 s | 627.6 | Failed 6/6 |
| Weight-only int8 | 96.76 | 14.51 s | 626.1 | Passed 6/6 |

Weight-only compression lowered measured peak process RSS by **54.0%**, but did not improve inference speed: 14.51 s versus 14.26 s. These timings exclude clip decoding and preprocessing, so end-to-end latency would be higher. It is the preferred compact candidate for further research, not a real-time or activated translator. The faster dynamic variant remains unsuitable for promotion while its cross-runtime discrepancy is unresolved.

Detailed native comparison and fixture hashes are in [the weight-only report](verification/bdsl401-weight-only-verification.json); [its WASM report](verification/bdsl401-weight-only-wasm.json) records the passing gate. [The dynamic WASM report](verification/bdsl401-int8-wasm.json) retains the failed gate, and [the float32 benchmark](verification/bdsl401-float32-wasm-benchmark.json) records the baseline.

## Benchmark conditions

Each WASM variant runs in its own Node process, sequentially on the same Linux x64 host (AMD EPYC 9V74, nine exposed logical CPUs). Node is v24.19.0; ONNX Runtime Web is 1.23.2 with one WASM thread. There is one untimed warm-up followed by one timed inference for each of the six clips. This is a small host-specific comparison, not a statistically robust performance or accuracy benchmark.

Peak RSS covers the whole Node process, including model buffers, fixtures and WASM. It is not browser memory. The benchmark checks model and fixture hashes, 401 finite output logits, per-class numerical differences, and ordered top-five agreement against each variant's own native references. It does not compare compressed logits to float32 using an equivalence assertion.

## Reproduction and release state

Commands are in [training/README.md](../training/README.md#bangla-size-and-runtime-experiment). Verification reports under `docs/verification/bdsl401-*` retain model hashes, clip hashes, predictions, timings and failed gates. The downloader's verified transfer, cache reuse and corruption-preservation behavior were checked. The three preprocessing/class-order unit tests and lint passed.

No model weights, videos or tensors are committed or installed into public assets. No language is newly counted toward the 15-language goal by this experiment. Readable Bangla vocabulary, independent signer evaluation, actual browser/camera behavior and acceptable live latency remain outstanding. Deployment remains deferred.
