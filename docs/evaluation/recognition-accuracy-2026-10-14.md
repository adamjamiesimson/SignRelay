# ASL/BSL accuracy investigation and remaining release blockers

## Changes

Starter rules previously returned the first matching temporal window. They now inspect the available windows and abstain if open-palm evidence conflicts between HELLO, PLEASE and THANK YOU. A closed-set model result cannot bypass this ambiguity veto. Explicit personal templates keep their independent matcher and thresholds. No model weights, handedness swaps, distance cutoffs or confidence thresholds changed.

Worker analyses/confirmations carry their actual source (`starter`, `personal`, `model`) so a wrong rule-based word is not attributed to the research model. The local diagnostic uses the actual pinned Web MediaPipe Tasks package, the production VisionEngine and the production recognition worker. It exports derived results/counters only, including every accepted word, not raw frames or landmarks. No production UI or route is added.

## Frozen real-video comparison

Six new PopSign ASL v1.0 game/test recordings: HELLO, PLEASE and THANK YOU from two source participants absent from the earlier `signrelay-latest-asl-evidence.zip` tuning evidence. They were chosen before looking at outcomes. This is project-level recording separation; identity overlap with upstream model-training data has not been verified. Publisher labels are used without a new fluent-signer annotation review. Treat this as a small diagnostic pilot, not a general accuracy estimate.

Source: https://signdata.cc.gatech.edu/view/datasets/popsign_v1_0/
CC BY 4.0; Georgia Tech Contextual Computing Group and Deaf Professional Arts Network. Frozen fingerprints and archive ranges are in `popsign-project-holdout-manifest.json`. Source media are excluded from Git.

Exact PR #21 source (`84e239e9a9a9b1423831c7560af39f050f158f8b`) and the candidate received the same unique decoded source frames, at at most 20Hz, with no duplicated end frames or artificial pause. Both versions were run twice in headless Chrome 151.0.7922.34 with the actual Tasks runtime at 0.10.22-rc.20250304. Outcomes and hand-frame counts repeated exactly across both passes.

| Per pass, 6 signed trials | PR #21 | Candidate |
| --- | ---: | ---: |
| Correct complete trials | 2/6 | 2/6 |
| Wrong accepted trials | 2/6 | 1/6 |
| Abstentions | 2/6 | 3/6 |
| Precision among accepted trials | 2/4 | 2/3 |

The PLEASE→THANK YOU acceptance becomes an abstention. THANK YOU→PLEASE remains a **wrong starter-rule acceptance** in one clip. HELLO is recognized in one of two clips. Hand tracking is sparse in several clips: 4/31 to 16/34 hand-visible frames on failures. Hand presence does not establish landmark quality.

No threshold/rule tuning was done after inspecting these six outcomes. Two passes are repeatability evidence, not twelve independent recordings. The raw derived rows and paired comparisons are under `asl-2026-10-14/`.

No new no-sign or unknown-sign recordings completed in this run. Previously used Wikimedia controls and a separate BSL dictionary source could not be retrieved (HTTP 403); no false-accept rate is inferred from an empty denominator. The evaluator reports no-sign false accepts and out-of-vocabulary false accepts separately, rejects duplicate recording fingerprints, keeps development/declared-held-out groups separate, and treats extra wrong confirmations as failures even when another confirmation was correct.

## Actual Tasks handedness investigation

The raw Web Tasks `handedness[index][0].categoryName` labels are preserved; unexpected labels become Unknown. The exact image/canvas sent into Tasks is unmirrored in production. CSS preview mirroring has no effect on those pixels. Tensor-slot tests verify signer-left/right ASL and BSL nodes.

The diagnostic independently controls CSS preview mirroring and actual pixel mirroring, compares the raw Tasks label with a human-declared physical hand and with the nearest visible pose wrist, and displays ASL/BSL hand-slot ranges. Pose agreement is a consistency check, not ground truth. Actual video counters show predominantly right-hand/pose-right agreement when a usable pose wrist is present, with occasional label disagreement; they do not justify a global swap.

Official Web API: https://developers.google.com/edge/mediapipe/solutions/vision/gesture_recognizer/web_js
Upstream Tasks-vs-legacy handedness documentation issue: https://github.com/google-ai-edge/mediapipe/issues/6376
The old legacy Hands selfie-mirroring note must not be used as proof that this newer Tasks version needs its hands swapped.

## Reproduce

1. Run `python training/fetch_evaluation_clips.py`; videos remain under ignored `evaluation/videos/` and must match frozen SHA-256 values.
2. Run `npm run build:firebase`, then `node scripts/prepare-recognition-lab.mjs`.
3. For a baseline, materialize `lib`, `workers`, and `tsconfig.json` from the exact PR #21 commit in an isolated directory, link its `public` directory to these unchanged model assets, and bundle its recognition worker to `out/workers/baseline-recognition.worker.js` with esbuild. Keep that bundle in `out/`, never `public/`.
4. Run `node scripts/run-recognition-video-evaluation.mjs /path/to/chrome docs/evaluation/popsign-project-holdout-manifest.json candidate.jsonl` and repeat with `--baseline` and a different output filename. Use separate result files for repeat passes.
5. Compare with `node scripts/compare-recognition-evaluation.mjs baseline.jsonl candidate.jsonl`. Fingerprints, orientations, expected glosses, capture mode and Tasks version must match.

This container required Chrome's headless-shell build because regular Chrome's process-singleton socket is unavailable. Its browser could not trust the managed network proxy's certificate. `--fetch-assets-via-node` forwards only GETs for the fixed public Tasks WASM/model URLs through Node's normal TLS-verified fetch; it does not disable browser TLS or CSP, forward video, or alter inference. Browser logs included canceled/revoked Blob reads during file cleanup, with no missing required runtime assets or model errors. Cleanup now clears the video source before revoking its Blob URL.

## Manual verification required before release

- On two real devices, raise the real right hand alone, then the left; repeat with preview mirroring on/off and with an actually pre-mirrored camera feed. Record human truth and raw Tasks labels. Do not change production mapping until this evidence supports it.
- Obtain consented/licensed, fluent-signer-reviewed BSL clips with verified recording and signer separation. Measure correct trials, wrong accepted trials, abstentions and no-sign/out-of-vocabulary false accepts. Confirm BSL input orientation against source-model expectations.
- Expand ASL beyond this six-clip pilot, with previously unseen signers, idle activity and near-miss open-palm movements. Investigate the remaining THANK YOU→PLEASE failure on separate development data, then reserve new holdouts.
- Check phone responsiveness, battery/memory behavior, interruptions, language changes and camera stop/restart under a throttled connection.

Accuracy and negative-trial coverage remain release blockers. This work does not establish production-quality translation.
