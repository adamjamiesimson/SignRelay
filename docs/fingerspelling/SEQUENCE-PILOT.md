# Genuine sequence-inference pilot — 31 October 2026

This follow-up to draft PR #48 trains and exports a real recogniser. It is an experimental sequence candidate, not validated webcam recognition. The historical interface report described interface-only work; its zero-coverage status is superseded only by the measured evidence here.

## Measured recognition

- Scope: non-sensitive, publisher-labelled fingerspelling; 3–18 ASCII letters/spaces, 1–16-second annotation intervals, source clip at most 40 MiB. Digits, punctuation and other sequence lengths are outside this pilot.
- 512 training sequences / 94 signers; 64 validation / 15 signers; 96 sealed test / 15 signers. Publisher signer sets are asserted disjoint. No validation/test sequence is removed for poor tracking. No exact test/validation phrase appears in training (checked against the full publisher splits).
- Test: **260 edits / 1,216 reference characters = 21.3816% CER**, including spaces. 90 substitutions, 109 deletions, 61 insertions; 1,017 aligned correct characters. **6/96 exact sequences = 6.25%**.
- Validation-selected epoch 71: 25.9880% validation CER, 2/64 exact. Training CER 0.2564%, 506/512 exact. This gap demonstrates overfitting; the small pilot needs substantially broader training.
- Exact test examples include ESTEVAN WONG, GREG RIVERA, LOWELL MA and PLUSS. Failures include AUSTIN TX → ARESGIN GT and TRACY POWELL → TRACY POWEL. These are held-out recognition outputs, not controller fixtures.
- 25 letters have at least one aligned correct test instance. Q has **0/1**; X **1/6**, U **8/20**. This is not certified support for 25 letters or all A–Z. J **6/6**, Z **3/4** are very small counts, not evidence of robust motion recognition. Repeated letters have genuine successes and deletions; see every hypothesis in [the sealed report](evidence/fsboard-v13-pilot.json).
- Negative diagnostic: **11/112 = 9.82%** real outside-annotation intervals produced nonempty raw CTC output, 21 inserted characters. These are **unreviewed proxies**, potentially containing signing or transitions, not validated ordinary-hand-movement negatives. No production false-accept rate or calibrated confidence threshold is established.

| Reference letter | Aligned correct / total | Reference-character recall |
|---|---:|---:|
| A | 139/146 | 95.2% |
| B | 20/22 | 90.9% |
| C | 41/43 | 95.3% |
| D | 39/41 | 95.1% |
| E | 102/116 | 87.9% |
| F | 13/16 | 81.3% |
| G | 20/25 | 80.0% |
| H | 32/36 | 88.9% |
| I | 63/71 | 88.7% |
| J | 6/6 | 100.0% |
| K | 14/16 | 87.5% |
| L | 66/77 | 85.7% |
| M | 22/26 | 84.6% |
| N | 81/92 | 88.0% |
| O | 68/76 | 89.5% |
| P | 8/12 | 66.7% |
| Q | 0/1 | 0.0% |
| R | 75/89 | 84.3% |
| S | 49/57 | 86.0% |
| T | 47/55 | 85.5% |
| U | 8/20 | 40.0% |
| V | 17/22 | 77.3% |
| W | 11/13 | 84.6% |
| X | 1/6 | 16.7% |
| Y | 21/27 | 77.8% |
| Z | 3/4 | 75.0% |

Reference-character recall is edit-alignment recall, not independent frame-class accuracy; insertions are separately included in CER. Spaces: 51/101 correct, 16 substitutions, 34 deletions.

## Genuine inference measurements

[Training and native evaluation run](https://github.com/adamjamiesimson/SignRelay/actions/runs/41211037508), source commit `3c69ea0676e4e745ae575ddb4fce2a836933aa10`. Raw extraction completed 672 publisher-verified clips. Source FPS ranged 23.9158–30.1547; effective sampling 11.9579–15.0774 Hz. Train returned-hand categories: 415 Right / 97 Left; validation: 59 Right / 5 Left; sealed test: 96 Right / 0 Left. Training/evaluation/export took 210.57 seconds on remote Linux x86-64, Python 3.11.17, PyTorch 2.5.1+cpu, two Torch threads; total data preparation took about 25 minutes.

123,772 parameters; ONNX opset 17; **497,759 bytes**, SHA-256 `fbf35592acd849bf3b6b5621a23465ed134ffbc6ab049fbbf8db75916177c29a`. [Committed native report](evidence/fsboard-v13-pilot.json), [source provenance](evidence/fsboard-v13-provenance.json), [browser evidence](evidence/fsboard-v13-browser.json), [vocabulary](evidence/fsboard-v13-vocabulary.json). Full training state is retained in the original Actions artifact until 14 November 2026; browser weights and aggregate evidence are committed.

- PyTorch → native ONNX: 8 real sealed test sequences, same decoded text; maximum absolute logit difference 0.00000858306884765625.
- PyTorch → actual Chrome WASM worker: same text on all 8; maximum absolute logit difference 0.000014066696166992188. Python → TypeScript feature error at most 4.76837158203125e-7.
- Headless Chrome 156 / Linux runner: 40 warm real-sequence WASM runs, **1.2 ms median / 1.7 ms p95**, 40–109 frames; model loading 685.8 ms. Native PyTorch test median 2.70 ms / p95 3.91 ms.
- Timings exclude camera capture, MediaPipe, window duration, rendering and user review. They are not webcam end-to-end latency, mobile performance or FPS.
- Actual model worker reset/latest-request replay accepted no old results. Reset terminates the worker. This probe does not prove that termination happened during an already executing native ORT call.

## App integration evidence

[Real-source app replay](https://github.com/adamjamiesimson/SignRelay/actions/runs/41214804872), commit `d5b6040b23b486a8e6f2341b4b0d076b66a88665`, re-downloads and verifies two known held-out recordings, re-extracts their hand landmarks, and replays them through the actual capture UI, model worker, candidate display and explicit confirmation. Both **PLUSS** (including SS) and **ESTEVAN WONG** reached the composed draft correctly. Native ONNX text matched the exact inputs captured by the app. No text or speech occurred before confirmation; confirmation consumed the candidate, cancellation cleared it, and the word transcript was preserved. [Committed aggregate evidence](evidence/fsboard-v13-app-replay.json).

The camera pixels are fake in this integration harness. Real recorded landmarks, source aspect, timestamps and model weights are used. These two selected known examples are wiring checks, not another accuracy estimate or validation of live RGB tracking.

To try the preview: select ASL → Start signing → Fingerspelling → wait for Capture name → Capture name → fingerspell → Finish capture → review candidate → Confirm text. Edit the draft when needed; use Space between separate captures. Speak is always explicit.

## Software verification and inherited failures

At `d5b6040b23b486a8e6f2341b4b0d076b66a88665`: [isolated verification](https://github.com/adamjamiesimson/SignRelay/actions/runs/41214804931) passes typecheck, 1,004 tests (2 skipped, 101 files), lint, worker build, asset guard and all 8 browser regression groups. These are software checks, separate from the real-data metrics. [Core CI](https://github.com/adamjamiesimson/SignRelay/actions/runs/41214808171) also passes secret scanning with zero findings, then fails the existing dependency audit: 16 moderate development dependency findings rooted in unreviewed minimatch GHSA-g3hv-75wg-m249; zero production advisories. No lockfile, audit policy or exception was changed. The inherited [ASL word-video pilot](https://github.com/adamjamiesimson/SignRelay/actions/runs/41214808101) still fails fetching its six licensed frozen clips under TLS validation; no bypass was added. This is distinct from the successful FSboard raw-video run.

The one-off blob-preservation workflow was removed after its checksum-reviewed model/evidence blobs were committed. Ongoing new research/replay workflows have read-only repository permissions.

## Architecture and annotations

A frame classifier was investigated, but FSboard provides sequence transcripts and annotation intervals, not individual letter timestamps. Treating every frame as the whole transcript or a letter would invent labels. OpenFS's frame classifier relies on recogniser-derived embeddings/weak labels, not an independent static hand-to-A–Z model.

The independent pilot uses 66 inputs → Linear(96)/LayerNorm/ReLU → bidirectional GRU(96 each direction) → 28 logits, CTC loss, greedy decoding. Blank is index 0, space index 1, A–Z indices 2–27. CTC collapses repeated adjacent emissions, while blank-separated emissions preserve doubled letters. Temporal landmarks and wrist trajectory carry J/Z and double-letter motion. The bidirectional model needs a completed capture window; it is not streaming letter classification. Blank is a latent alignment token, not supervised proof of no signing.

## Preprocessing contract and remaining validation

MediaPipe Tasks **0.10.35**, official GestureRecognizer task (8,373,440 bytes, SHA-256 `97952348cf6a6a4915c2ea1496b4b37ebabc50cbbf80571435643c455f2b0482`), VIDEO mode, two hands, detection/presence/tracking thresholds 0.55. Hand-only model; no face/pose assumptions or custom gesture labels.

Order is MediaPipe's 21 landmarks: wrist 0; thumb 1–4; index 5–8; middle 9–12; ring 13–16; pinky 17–20. Each frame is x,y,z per landmark, not world landmarks. Image x/z use width units, y height units; y is divided by width/height before palm scaling. Subtract wrist xyz; divide by 2D wrist-to-middle-MCP distance, floor 1e-4; flip relative x and wrist-trajectory x for the returned Left category; no rotation normalisation. Append wrist xy relative to the first valid wrist *inside this sequence*, multiplied by 4, then a presence flag. Clip numeric features to [-8,8]; a missing hand is 66 zeros, never a synthetic letter.

Training decodes raw clips with OpenCV orientation metadata, RGB and max side 640. Source FPS must be 10–65, recorded per clip; sampling uses every round(FPS/15) frames and frame-index/FPS timestamps. Annotation bounds are relative to clipStartTimeS. This nominal-FPS convention is reproducible; variable-frame-rate presentation-timestamp equivalence has not been established. Dominant returned hand category is chosen by valid frame count inside the interval. All 96 sealed test examples were returned as Right; left-category live recognition has no held-out coverage in this pilot.

Live capture uses the existing raw, unmirrored video/MediaPipe stream; the display's CSS mirror is not applied to features. Captured hand frames are resampled to a 15 Hz nearest-time grid, using actual monotonic tracker timestamps; UI target 1–16 seconds (captured frame span at least 850 ms), at least 12 tracker frames/s, no gap above 200 ms, and at least 60% complete dominant-hand observations. These are structural quality gates, not statistically calibrated confidence/negative rejection. Model loading verifies size/SHA and stays in its own WASM worker. No video or landmarks leave the browser.

**Validated:** real-video extraction, native/ONNX/browser logits, exact hand-array → feature parity. **Not yet validated:** Python versus browser MediaPipe extraction on identical RGB frames, CPU/GPU delegate equivalence, physical left/right ground truth, mirrored recordings, variable-frame-rate timestamps, live webcam performance, ordinary non-sign movement, fluent-signer acceptability. The live tracker can use GPU while training used CPU. A source-category mirror convention is not a physical-handedness accuracy claim.

## Resource and licence decisions

- [OpenFS](https://github.com/AIRC-KETI/OpenFS), reviewed at `0d6fa3fa9b5aeaf99171e8c77e89531a22a6fd27`: non-commercial research/education restriction. No OpenFS code, checkpoints, processed data, weak labels or embeddings were incorporated or executed. Its reported FSboard landmark issue motivated independent raw-video re-extraction; this sprint does not claim to have independently proved the supplied landmark files corrupt.
- [FSboard](https://www.kaggle.com/datasets/googleai/fsboard), version 13: publisher metadata states CC BY 4.0. Attribution: Google / Deaf Professional Arts Network. Modifications: alphabetic non-sensitive sequence subset, uppercase, independent MediaPipe extraction and original model training. Dataset metadata SHA-256 and per-video publisher size/MD5 plus computed SHA-256 are checked/recorded; TLS validation remains enabled. The complete dataset is approximately 1.45 TB; the pilot downloads individual raw clips.
- Kaggle first/fifth-place implementations have Apache-2.0 code but no ready checkpoint in their inspected repositories. The second-place H5/TFLite repository has no explicit repository licence; no licence was inferred from a different competition. A CoreML-only Apache-labelled conversion was also investigated, but its native runtime/input/provenance requirements were not verified as a browser-ready adoption. None of these weights were used.
- The installed ONNX model is independently trained from the above FSboard subset. [Attribution and modifications](../../public/models/asl-fingerspelling/NOTICE.md).

## Reproduce on a remote Linux runner

No laptop automation or Firebase deployment is needed:

```sh
sudo apt-get update && sudo apt-get install -y libgles2 libegl1 libgl1
python3.11 -m venv work/fs-env
. work/fs-env/bin/activate
python -m pip install -r training/fingerspelling/requirements.txt
python -m pip install torch==2.5.1 --index-url https://download.pytorch.org/whl/cpu
python training/fingerspelling/prepare.py --train 512 --validation 64 --test 96 --workers 2
python training/fingerspelling/train.py --epochs 100
npm ci
node scripts/copy-onnx-runtime.mjs
node scripts/diagnostics/fingerspelling-browser.mjs "$(command -v google-chrome)"
npm run typecheck
npm test
npm run lint
npm run build:worker
npm run repo:guard
npm run build:rehearsal
node tests/fingerspelling-browser-smoke.mjs "$(command -v google-chrome)"
```

The research workflow reruns on training-source changes, not documentation/diagnostic-only edits. The seed is 4826; selection, metadata versions and hashes are fixed. Different CPUs/native libraries can cause floating-point or checkpoint differences; compare recorded metrics and parity rather than promising a bit-identical retrain.

## Release decision

**Research proof of concept: working. General webcam/name recognition: unvalidated, NO-GO for reliability claims.** The preview exposes experimental manual sequence capture and a reviewable text candidate, with explicit confirmation and speech only on request. No model score is presented as calibrated confidence. Model/shape/timing/no-hand failures abstain. Arbitrary hand motion can still produce a candidate.

PR #48 remains draft on its existing feature branch, with the original word-recognition worker, logo, design, Firebase configuration and security gates preserved. No merge or Firebase deployment is authorised or performed. Software-only regressions are reported separately from the real-data recognition and inference measurements above.
