# Engine 1 and Engine V3.1 comparison

## Revisions and acceptance policy

- Engine 1 ran the ASL demo export built from `5c24302`, the recognition implementation carried into PR #66 head `9127ab4`. The production recognition worker SHA-256 was `3510843cc821cbbdb9dc227d1f68dff8ded10dce77620bde0198bf4e7e2456c1`. Its packed ASL-2000 model manifest SHA-256 was `ebac604f1c4ee86a7b3b20cfaa9c3a8f157cc814ad0c94e6a87be7902b3ac466`. The worker automatically confirms starter-rule words and can surface a closed-set research model suggestion. The test profile had no saved personal examples. [PR #66](https://github.com/adamjamiesimson/SignRelay/pull/66)
- Engine V3.1 ran the standalone browser camera and worker pipeline from PR #65 head `ea4e5432df811fcfb91db926b741d21b12222098`. Its 523-class ONNX checkpoint SHA-256 was `b3e05424f4674d8235ac8bc51970cef6822e12ac629c4a02bca596bc7f5d3090`. The experiment forced CPU on the host with software WebGL and used the published pose cadence and scheduler. [PR #65](https://github.com/adamjamiesimson/SignRelay/pull/65)
- Both V3.1 presets use temperature 0.80977, maximum unknown score 0.30, minimum top-1 score 0.847086 and a three-hand-frame minimum. Strict raises the prototype cosine minimum from 0.637995 to 0.812137. Balanced policy SHA-256 is `feca858e67e0fa5bd89ee3be7ce80bd599a7c9ab0ac8d7f952c52648519e460a`. Strict policy SHA-256 is `751fd950bde3ab3166653bb1dd4884a155fd831bb92bc4a7a16a6691c5fb48e0`. [Frozen model and policy files](../../engine-v3/models/v3.1/)

## Browser camera method

The shared reel contains the 11 previously inspected PopSign recordings, five additional PopSign ASL v2.1 publisher validation clips and one deliberate repeat of the same NO clip. It covers HELLO, THANK YOU, PLEASE, YES and NO. In V3.1, THANK YOU is `THANK-YOU`. The model vocabulary omits SORRY.

The broader V3.1 reel contains one publisher validation clip for each of 12 supported signs and four out-of-vocabulary signs from the declared calibration cohort. The rows, published source URLs and file checksums are frozen in [engine-comparison-development.json](engine-comparison-development.json). The additional clips were selected by a deterministic filename hash within each sign directory before running any model. RED replaced SCHOOL when the publisher validation directory for SCHOOL was unavailable. No reserved footage was fetched or decoded.

Each pipeline received the same checksum-verified 640×480 15 fps Y4M for a given reel using Chromium's fake camera. The reel has an eight-second pre-roll, two-second grey intervals between clips and a final grey tail so tracking can start and pending output can finish. The license is CC BY 4.0, credited to Georgia Tech Contextual Computing Group and Deaf Professional Arts Network. No raw videos or landmarks are in the reports.

The scorer grades every policy-accepted output associated with a trial. Any wrong accepted word makes that trial wrong. It assigns an output to a clip using the engine's time anchor, a 100 ms lead and an 850 ms tail. An Engine 1 confirmation uses its emission timestamp. A V3.1 result uses its completed segment end, with event receipt times reported separately. The runner records blank-gap accepts, duplicate accepts and the intentional repeat outcome. Engine 1 model suggestions are recorded separately from automatic starter confirmations. A V3.1 lab acceptance means the classifier policy accepted a segment. In the integrated workspace it is eligible for a tentative suggestion requiring explicit user action.

This is a comparison of the published browser paths, including their different trackers, segmentation, and posting behavior. The same replay can therefore deliver a different number of frames to each classifier. It is separate from October's 5 correct, 0 wrong and 6 abstentions on the same 11 records. That trial stepped through decoded source frames at up to 20 Hz and did not use a real-time fake camera. [October pilot](../evaluation/ci-pilot-rerun-2026-10-21.md)

## Measured decision: V3.1 Strict with manual review

Select **V3.1 Strict** for the normal ASL workspace. Do not automatically append its predictions or speak them. Unknown-sign rejection remains insufficient for unattended translation. Engine 2 is not used.

| Same shared replay: 17 intervals, 16 distinct clips, five labels | Correct | Wrong | Abstained | Gray-gap accepts | Duplicate accepts |
| --- | ---: | ---: | ---: | ---: | ---: |
| Engine 1 original app | 1 | 0 | 16 | 0 | 0 |
| V3.1 Strict reference lab | 10 | 0 | 7 | 0 | 0 |
| V3.1 Balanced reference lab | 11 | 1 | 5 | 0 | 0 |
| V3.1 Strict integrated application | 10 | 0 | 7 | 0 | 0 |

Balanced accepted one HELLO as GIVE-ME-FIVE. Strict abstained on more clips but avoided this observed wrong suggestion. Each arm completed without runtime errors and released all camera tracks. The lab Strict replay missed the deliberate NO repeat; Balanced and the integrated replay recognized it. The integrated and lab Strict correct sets differ: do not interpret equal totals as identical behavior. [Per-trial JSON evidence](evidence/engine-comparison/)

Engine 1 forwarded 741 frames (9.55 fps); reference Strict 583 (7.52 fps); integrated Strict 669 (8.63 fps). The integrated app cold camera startup was 2,246 ms, with main-thread heap samples 5.16 to 5.34 MB (not total model/worker memory). It used CPU on Chromium 156/Linux with software WebGL. No competing production build ran during measurement. Zero transcript entries and zero speech calls were observed before manual review. The integrated scorer uses emission timestamps because the UI protocol does not expose lab segment-end timestamps; delay and boundary comparisons across paths have that limitation.

This small development replay supports the engine choice and the manual-review boundary. It does not establish physical signing accuracy or reliable rejection of ordinary activity. Historical unknown-sign false accepts below are a material reason to retain user review.

## Historical broader evidence

These figures are already published evaluation results on their original cohorts. No trial was rerun for this comparison.

| V3.1 setting | Broad result | Rejection |
| --- | --- | --- |
| PopSign test round 1, 2,885 supported clips, 10 signers | 83.6% raw top-1 across 523 classes. Balanced 68.2% accepted correct, 3.3% accepted wrong. Strict 56.9% accepted correct, 2.4% accepted wrong. | 29.2% balanced and 22.9% strict on 48 unknown clips |
| ASL Citizen webcam-domain validation, 1,100 supported, 5 signers | 61.9% raw top-1. Balanced 45.1% accepted correct, strict 34.3%. | 15.0% balanced and 5.3% strict on 300 unknown clips |
| Four prerecorded 30 fps camera reels, 48 supported intervals | 35 accepted correct, 0 accepted wrong, 13 abstained | 2/8 unsupported intervals accepted |
| Browser file mode, 523 representative clips | 429 top-1 correct, 346 accepted correct, 20 accepted wrong | 3 no-sign detections |

The reported dataset, file replay and streamed camera conditions are distinct and the clips overlap across some historical rows. Do not pool them. Ordinary non-sign activity, physical cameras, independent live signers and real phones remain unmeasured. [V3.1 engineering report](../../engine-v3/REPORT-V3.1.md)

## Reproduce the browser comparison

Use Node, Chromium, Python and FFmpeg. Keep both served exports unchanged while replay runs. The Engine 1 export is available by checking out `5c24302` in a separate worktree and running `npm ci` then `npm run demo:prepare`. The V3.1 reference lab can be built from `ea4e543` with the same Node package setup. The lab build downloads and verifies required Google MediaPipe assets.

```bash
# Run from the repository containing this comparison harness.
mkdir -p work/engine-comparison
python3 training/fetch_evaluation_clips.py
python3 training/fetch_evaluation_clips.py docs/evaluation/popsign-development-2026-10-16.json

python3 scripts/diagnostics/build-engine-comparison-reel.py \
  docs/showcase-2026-11-26/engine-comparison-development.json \
  work/engine-comparison/shared.y4m work/engine-comparison/shared-truth.json \
  --cohort shared --fetch-validation
```

In the separate Engine 1 checkout, start `npm run demo:serve`. In the V3.1 reference checkout, run `NODE_USE_ENV_PROXY=1 node engine-v3/web/build.mjs engine-v3/models/v3.1` and `node engine-v3/web/serve.mjs engine-v3/web/dist 8790`. Point each run below at its local origin. The script requires a new output filename on each run.

```bash
node scripts/diagnostics/run-engine-comparison.mjs /usr/bin/chromium \
  http://127.0.0.1:4173 work/engine-comparison/shared.y4m \
  work/engine-comparison/shared-truth.json engine1 work/engine-comparison/engine1.json

node scripts/diagnostics/run-engine-comparison.mjs /usr/bin/chromium \
  http://127.0.0.1:8790 work/engine-comparison/shared.y4m \
  work/engine-comparison/shared-truth.json v3-strict work/engine-comparison/v3-strict.json

node scripts/diagnostics/run-engine-comparison.mjs /usr/bin/chromium \
  http://127.0.0.1:8790 work/engine-comparison/shared.y4m \
  work/engine-comparison/shared-truth.json v3-balanced work/engine-comparison/v3-balanced.json
```

For the broader reel, use `--cohort broad` and fresh filenames in both commands. The uncompressed reels occupy about 1 GB together and the scripts can regenerate them from verified clips.
