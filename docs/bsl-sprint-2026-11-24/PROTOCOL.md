# BSL recognition sprint 2026-11-24: evaluation protocol

Written before any BSL accuracy result was produced. Baseline revision: `1b888fa` (main after PR #69).

## What is compared

| Variant | Worker | BSL input | Model output delivery |
| --- | --- | --- | --- |
| **baseline** | `main` worker bundle (`out/workers/baseline-recognition.worker.js`) | last 16 observed frames, Tasks hand labels | inference every 6 frames while the motion gate is ready; two equal results auto-confirm into transcript (and speech when enabled) |
| **candidate / legacy input** | this branch, `bslEngine=legacy` | as baseline | one decision per completed movement, reviewable suggestion only |
| **candidate / v2 input** | this branch, `bslEngine=v2` | BSL-1K contract: 25 fps, 16-frame windows (stride 8) over the movement, averaged logits, body-wrist hand slots, OpenPose-style missing joints | as above |

All variants use the same installed checkpoint (`bsl1k-pose2sign-bodyhands-v1`, unchanged weights and labels)
and the same 0.82 / 0.14 confidence / margin thresholds.

## Inputs

1. **Browser path** (`scripts/diagnostics/run-bsl-video-evaluation.mjs`): each licensed recording is decoded
   frame by frame (≤ 20 Hz unique frames, no duplicated or synthetic pauses) and passed through the pinned
   MediaPipe Tasks `VisionEngine`, the production recognition worker and the real ONNX model in headless
   Chromium. A fresh page, tracker and worker are used per recording. This is file replay, **not** physical-camera evidence.
2. **Identical-observation path** (`scripts/diagnostics/bsl-offline-replay.mjs`): the per-frame tracker output
   captured in step 1 (`--traces`, git-ignored) is replayed at its recorded timestamps through the worker and the
   real ONNX model in Node. Variants are compared on *identical* observations, removing tracker nondeterminism.

## Cohorts (manifests in this directory)

| Manifest | Role | Status |
| --- | --- | --- |
| `foreign-controls.json` | Non-BSL signing (ASL, PopSign CC BY 4.0) — false-accept and real-tracking controls only. Never scored as BSL. ASL HELLO is tagged `form-similar-to-bsl-hello` and reported separately. | run |
| `bsl-development.json` | Licensed BSL recordings for diagnosis/tuning, signer-separated from evaluation | **blocked — no permitted BSL video source reachable in this session** (see REPORT.md) |
| `bsl-evaluation.json` | Independent signers, run once for baseline and final candidate only | **blocked** |

Required composition for the BSL cohorts once a source is available (selection fixed before running):
common everyday signs from the installed vocabulary, two-handed signs, visually similar pairs, signs absent
from the 1,064-class vocabulary (`unsupported`), and ordinary non-sign movement (`non_sign`: scratching,
adjusting glasses, waving at the camera off-sign, reaching). Signers must not overlap between development and
evaluation where metadata permits.

## Scoring (`scripts/diagnostics/bsl-scoring.mjs`)

Per supported trial: **correct** (every accepted output equals the expected BSL-1K label), **wrong** (any accepted
output differs), **abstained** (none). Accepted = model suggestion or automatic confirmation. Strict label
equality; English near-synonyms are never rescored. Per negative trial: **false accept** or **rejected**.
Also: coverage, precision when accepted, threshold-free top-1/top-5 of the best model decision per clip,
duplicate outputs, runtime errors, per-window inference latency (p50/p95), hand-label corrections.

## Adoption rule (fixed before candidate runs)

The v2 input becomes the default only if, on the BSL development cohort and then confirmed once on the
evaluation cohort, compared with the legacy input on identical observations:

1. correct accepted signs increase by ≥ 2 and wrong accepts + false accepts do not increase; or top-5 improves by
   ≥ 10 points with no increase in wrong/false accepts;
2. no runtime error, no unreviewed transcript entry or speech call;
3. inference latency p95 stays below 400 ms per sign in the browser.

Until that evidence exists the worker default is the **legacy input**, with v2 selectable for evaluation
(`?bslEngine=v2` on the QA lab, `bslEngine` in the worker `templates` message). Changes that do not alter
classifier decisions on identical observations (suggestion-only delivery, once-per-movement scheduling,
diagnostics, model warm-up) are adopted on safety/lifecycle evidence.
