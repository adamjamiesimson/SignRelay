# Pretrained recognition continuation — 13 September 2026

## Download recovery

BSL-1064, INCLUDE-263 and the pending SWL-LSE runtime now share a loader that
caches successful sessions and clears rejected loads. Previously a transient
failure was cached permanently, so the worker's five-second retry could never
recover. Labels are checked before session allocation, preventing an orphan
session if label fetching fails. Non-finite model outputs are rejected.

The models retain their original labels, thresholds and preprocessing. No
additional pretrained language or recognition-accuracy claim is made by this fix.

## Spanish training repair

The latest previous [training run](https://github.com/adamjamiesimson/SignRelay/actions/runs/33857210483)
failed before its first epoch with `No module named 'mediapipe.framework'` while
unpickling official landmarks. The new workflow pins MediaPipe 0.10.21 and tests
legacy protobuf serialization before downloading the dataset. This preserves
the released files rather than substituting synthetic training examples.

Other changes:

- Verify the three archives/annotations against the checksums published in the
  [SWL-LSE release](https://zenodo.org/records/13691887).
- Decode legacy landmark files once into memory, instead of repeating the work
  in every epoch. Reject missing/empty/non-finite records and split overlap.
- Require all 300 classes in the training split. Use validation for checkpoint
  selection and evaluate the held-out test split once after selection.
- Match browser nearest-neighbour half-up rounding during sequence resampling.
- Require at least 50% validation accuracy before export. This is a coarse
  research installation gate, not evidence of safe use or camera accuracy.
- Compare ONNX output with PyTorch, record the model's SHA-256 and test results,
  execute the model in browser WASM, then activate only the LSE adapter.
- Run the Firebase build, recognition tests and lint before committing weights.
  Concurrent runs are serialized and pushes use rebase without force.

The upstream [legacy extractor](https://github.com/mvazquezgts/SWL-LSE/blob/main/mediapipe_keypoints/src/api/genKeypointsHolisticLegacy.py)
and [release writer](https://github.com/mvazquezgts/SWL-LSE/blob/main/mediapipe_keypoints/src/generate_mediapipe.py)
document the pickle structure. Live camera preprocessing is still experimental;
dataset evaluation is not a substitute for signer testing in the application.

## Verification and remaining work

The Firebase build, TypeScript, lint, exported-page checks, loader regressions,
real BSL/ISL WASM execution and legacy-reader regressions passed locally. A
synthetic 300-class network export is used only to check PyTorch/ONNX numerical
agreement, never as a trained model or measured accuracy result.

The new Spanish training run must complete before its 300-class model can be
reported installed. The release has 300 classes, so it cannot meet the requested
400-word minimum. The wider 15-language target remains incomplete; see the
[expansion audit](pretrained-expansion-2026-09-12.md) for the remaining sources.
