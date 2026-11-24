# BSL recognition sprint — report (24 November 2026)

**Bottom line.** The BSL pipeline has been audited against the original BSL-1K source code. Seven contract
mismatches were found and fixed in a new input adapter (v2). BSL model output can no longer reach the
transcript or speech without the signer pressing "Add to transcript". **BSL recognition accuracy is still
unmeasured.** No legally usable, correctly labelled BSL video could be obtained in this session, so there are
no top-1/top-5 numbers for BSL. Following the protocol fixed before any result, the default input stays
`legacy` until BSL video shows v2 is better.

## 1. Root causes found (details: [AUDIT.md](AUDIT.md))

1. **Wrong part of the sign.** The model was trained on 16 consecutive 25 fps frames *over* the sign. SignRelay gave
   it the last 16 frames at ~20 fps *after* a ≥ 230 ms stillness gate, so part of the window was the post-sign rest
   (1–8 of 16 frames on real tracker data, below).
2. **Hand identity.** OpenPose labelled hands by the body wrist they belong to (anatomical); SignRelay trusted the
   per-frame MediaPipe Tasks label, which disagreed with the body wrist on up to 11 % of hand frames in real clips.
3. **Off-screen legs.** MediaPipe extrapolates hips/knees/ankles below the frame; OpenPose outputs zeros there.
4. **Body pose stair-steps.** Pose is refreshed every ~150 ms and held between refreshes.
5. **No test-time averaging.** The original evaluation averages sliding windows (stride 8).
6. **Repeated inference counted as independent evidence.** Two near-identical re-runs on the same buffer
   "confirmed" a word.
7. **Unreviewed transcript/speech.** A closed-set, uncalibrated 1,064-class model could write and speak words
   automatically.

Verified correct: COCO-18 body ordering, 21-point hand ordering, tensor layout [1, 3, 16, 60], missing-hand zeros,
and label mapping (`labels.json` equals the original vocabulary pickle order for all 1,064 classes).

Not resolvable without BSL video: webcam vs broadcast-crop framing, the confidence channel, threshold calibration and
unknown-sign rejection.

## 2. Changes

| Change | Adopted? | Evidence |
| --- | --- | --- |
| v2 input adapter (`lib/bsl-pose2sign-input.ts`): 25 fps resampling with gap-bounded interpolation, movement-span selection, stride-8 windows, averaged logits, body-wrist hand slots, OpenPose-style zeros | **Implemented, opt-in** (`bslEngine: "v2"`) | Source contract; unit tests; real-ONNX test; control-clip behaviour below. No BSL accuracy evidence yet → not the default |
| One decision per completed movement; suggestion-only delivery; duplicate suppression (2.6 s) | **Adopted** | Safety requirement; worker tests; 0 transcript entries/speech calls from BSL model output |
| Model warm-up on BSL selection; first sign waits for the download | **Adopted** | Lifecycle tests |
| BSL `?perf` stage diagnostics | **Adopted** (developer view only) | Tests; no visual change outside `?perf` |
| Real-video harness, identical-observation replay, scoring | **Adopted** (tooling) | Runs below |

## 3. Results that exist (controls only — no BSL signs)

26 real recordings of **ASL** signing (PopSign v1.0/v2.1, CC BY 4.0, 9 signers) used *only* as non-BSL movement
controls, through the full browser pipeline (headless Chromium 151, pinned Tasks, production worker, real model):

| Variant | Clips | Reached the model | BSL false accepts | Highest non-BSL top-1 probability | Inference per sign (p50 / p95) |
| --- | ---: | ---: | ---: | --- | --- |
| baseline (`main` worker), browser | 26 | n/a (no decision telemetry) | **0** | — | — |
| candidate v2, browser | 26 | 4 | **0** | 0.30 (WANT) | 118 / 266 ms (2–5 windows) |
| legacy input, identical-observation replay | 26 | 4 | **0** | 0.65 (WANT) | 38 / 67 ms (1 window) |
| v2 input, identical-observation replay | 26 | 4 | **0** | 0.21 (WANT) | 72 / 249 ms |

On the same four observations, v2's top score on foreign signing was lower in every case (0.12–0.21 vs 0.21–0.65
with legacy). That suggests v2 may reject non-BSL movement better, but four ASL clips can't establish it.
Only 4/26 clips reached the generic motion gate: the clips are short (≈ 1.7–2.6 s) with sparse hand tracking
(4–45 hand frames). Window audit on those four ([results/window-audit.json](results/window-audit.json)):
legacy windows spanned ≈ 735 ms of 20 fps input, and 1–8 of their 16 frames fell after the movement ended.

Raw derived results: [results/](results/). They contain labels, scores and counters only — no video or landmarks.

## 4. What is still required (blocking a real baseline)

- **A licensed BSL video source.** BSL SignBank (`bslsignbank.ucl.ac.uk`), BSLDict (`www.robots.ox.ac.uk`) and
  Wikimedia Commons were unreachable from the sandbox. They were added to the environment's allowlist, but
  automated downloads from them were refused by this session's permission policy, so their terms could not be read
  and no clips were fetched. To run the BSL baseline, either allow those downloads for this work or supply
  licensed/consented BSL clips locally (git-ignored `evaluation/videos/`). Then:
  1. fill `bsl-development.json` / `bsl-evaluation.json` (format: `foreign-controls.json`; categories
     `supported` / `unsupported` / `non_sign` / `foreign_sign`; expected labels must be exact BSL-1K labels);
  2. run the harness three times (baseline worker, legacy, v2) and the replay on the captured traces;
  3. apply the adoption rule in [PROTOCOL.md](PROTOCOL.md).
- **Physical-camera rehearsal** of the showcase candidates: [SHOWCASE_REHEARSAL.md](SHOWCASE_REHEARSAL.md).

## 5. Reproduce

```bash
npm ci && npm run build:firebase && node scripts/prepare-recognition-lab.mjs
python3 training/fetch_evaluation_clips.py   # PopSign v1.0 controls (SHA-256 pinned)
# PopSign v2.1 controls: the 20 'A' rows of docs/sprint-2026-11-23/development-cohort.json (SHA-256 pinned)
# Baseline worker: bundle workers/recognition.worker.ts from main to out/workers/baseline-recognition.worker.js
node scripts/diagnostics/run-bsl-video-evaluation.mjs <chrome> docs/bsl-sprint-2026-11-24/foreign-controls.json out.json \
  --bsl-engine=v2 --traces=evaluation/raw/bsl-traces --fetch-assets-via-node
node scripts/diagnostics/bsl-offline-replay.mjs docs/bsl-sprint-2026-11-24/foreign-controls.json evaluation/raw/bsl-traces replay.json --bsl-engine=legacy
```
