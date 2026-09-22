# Recognition audit — 6 September 2026

This is a runtime reliability audit, **not an accuracy certification**. There is
no labeled real-signer evaluation corpus in this checkout. No percentage of
correct sign recognition was measured, and none of the six languages is
certified for continuous translation or reliable use across signers/devices.

## Language readiness

| Language | Automatic model in repository | What was verified | Accuracy on live signing |
| --- | --- | --- | --- |
| ASL | WLASL2000 Pose-TGCN, 2,000 outputs | Packed weights decompress; runtime produces finite outputs; worker regression checks | Unmeasured |
| BSL | BSL-1K Pose2Sign, 1,064 outputs | ONNX executes in WASM; output and label counts match; worker regression checks | Unmeasured |
| ISL | INCLUDE, 263 outputs | ONNX executes in WASM; output and label counts match; worker regression checks | Unmeasured |
| LSE | None; status `preparing` | No missing checkpoint requests; personal path preserved | No automatic model to evaluate |
| Auslan | None; status `preparing` | No cross-language classifier calls; personal path preserved | No automatic model to evaluate |
| CSL | Personal templates only | No cross-language classifier calls; personal path preserved | Requires separate enrollment and test recordings |

Vocabulary sizes are class/label counts, not accuracy scores. Personal starter
concepts are labels to teach, not pretrained sign-language examples.

## Faults reproduced and repaired

- ASL and BSL inference stopped once the rolling buffer reached 80 frames.
  Scheduling now uses a counter independent of buffer length. ISL's eight-frame
  cadence also remains stable after the buffer fills.
- Reading one cached prediction on successive camera frames was sufficient to
  confirm it. Automatic confirmation now needs two separate model results.
- Late BSL/ISL results could survive lost motion. Automatic results now expire
  on motion loss, reset, language change and confirmation. Results more than
  2.5 seconds behind the current frame are discarded. This is a reliability
  limit, not a threshold tuned using signer data.
- Pending LSE still attempted to load a nonexistent checkpoint. Automatic
  dispatch now respects the installed model status; personal recognition remains
  available separately in all six languages.
- Non-finite confidence could pass numerical comparisons. It is now rejected.
- The deployed `/workers/ort-wasm-simd-threaded.jsep.wasm` returned HTTP 404.
  `build:worker` now copies the matching WASM binary and fallback JavaScript
  module from the locked ONNX Runtime package. They are included in Firebase's
  `out/workers` export, without introducing a runtime CDN dependency.
- Language selection resets personal-recording UI state in the selection event,
  resolving the existing React lint error. Generated runtime bundles are excluded
  from source linting.

## Checks performed

`npm test`: 48 passing tests. These include synthetic worker lifecycle cases,
finite model execution, asset integrity and existing decoder/template tests.
They do **not** represent 48 correctly recognized real signs.

`npm run lint`: no errors; two existing Next image optimization warnings.
`npm run build:firebase`: successful static export of the existing routes.

On the live Firebase site, all six language selections opened the corresponding
translator, transcript controls and personal vocabulary. No camera signing or
speech accuracy test was performed. This environment's browser could not access
the local test server; the repaired browser loading path still needs a check
after Firebase deployment. Node WASM execution is not equivalent to a complete
mobile or tablet camera test.

## Remaining blockers and the next accuracy evaluation

The [Spanish training run](https://github.com/adamjamiesimson/SignRelay/actions/runs/33857210483)
failed with `ModuleNotFoundError: No module named 'mediapipe.framework'` while
unpickling the official data. Before restarting training, verify the legacy
MediaPipe dependency and the release's actual record layout: the current reader
silently converts non-list input to all zeros. It must fail on malformed or empty
training examples. Preserve the official train/validation/test partitions and
evaluate the final exported ONNX on the untouched test split. No training restart
or new checkpoint is included in this reliability fix.

Auslan and shared CSL models still need suitable training data, implementation
and evaluation. ASL/BSL also need to validate their live MediaPipe adapters
against the source OpenPose preprocessing. Published checkpoint results and the
ASL exporter's random-input agreement do not establish live camera accuracy.

For each language, obtain consented, fluent-signer-verified recordings with
expected gloss sequences, anonymous signer IDs, device/orientation and capture
conditions. Keep evaluation signers separate from training signers; personal
recognition requires separate enrollment and evaluation takes. Include idle
hands, tracking loss, unrelated motion and out-of-vocabulary signing.

Replay the exact deployed vision/worker pipeline and report per language:
correct confirmed signs divided by labeled signs (count abstentions as misses),
precision among confirmations, coverage, per-class confusion, false
confirmations per idle minute, duplicate output and confirmation latency.
Report continuous-sign sequence errors separately from isolated-word accuracy.
Measure phones/tablets in portrait and landscape using real cameras. Tune on
validation data, freeze thresholds, then evaluate on the held-out recordings.
