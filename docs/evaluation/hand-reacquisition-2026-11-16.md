# Same-frame hand reacquisition, 16 November 2026

**Status: tracker repair in `lib/vision-engine.ts`. Real-video outcome NOT YET MEASURED** (the PopSign host is blocked in the sandbox this was written in; the paired CI pilot and baseline gate run on the pull request). The recognition worker is byte-identical (`ccce84c8…`): no rule, threshold, confirmation or arbitration change.

## Defect

MediaPipe's VIDEO mode follows each hand inside the region predicted from the previous frame. When a hand moves far enough between two frames, that region misses it: the frame is returned with **no hand**, and palm detection only restarts on the *next* frame. A fast stroke is therefore observed as `#.#.#.#`.

Every ASL path needs continuous observations (the rules: 5 samples covering 60% of a window; the motion gate and the model: 6). On the 11 development clips the tracker reported a hand in 150 of 414 frames; the YES miss had 5 hand frames and never more than two in a row, the pattern this defect produces. Whether this defect is the cause on those clips is not established until the pilot runs.

## Repair

When the tracker returns no hand on a frame **and had one on the previous frame**, `VisionEngine.process` asks once more for the same image (timestamp + 1 ms). With no region left to follow, palm detection runs on that image. One retry per loss, none while no hand is visible. Every landmark comes from the current camera image: nothing is interpolated, copied from an earlier frame or relabelled, and no detection, presence or tracking threshold changed.

## Evidence (pinned runtime, headless Chromium, software rendering)

`node scripts/diagnostics/hand-reacquisition-probe.mjs <chrome> docs/evaluation/hand-reacquisition-2026-11-16/probe.json` moves three public MediaPipe test photos (thumb up, fist, two open hands) across a canvas with motion blur, at 0–1500 px/s, 50 and 66 ms frame intervals, and compares the pre-repair call pattern with the production engine. Full rows: [`probe.json`](hand-reacquisition-2026-11-16/probe.json).

| 42 moving runs, 2,520 frames | Before | After |
| --- | ---: | ---: |
| Frames with a hand | 2,441 | 2,518 |
| Runs with at least one dropped frame | 14 | 2 (both miss only the very first frame, before any hand was tracked) |
| Retries / recovered | n/a | 92 / 89 (the other 3 are the photo really leaving the frame) |
| Hand frames after the photo left, or in an empty scene | 0 | 0 |

Slow or still hands (0–300 px/s) were never dropped, before or after. Losses start at 600–1000 px/s and are worse at 66 ms than at 50 ms intervals.

**Limits.** A translated photograph is not a signer: no handshape change, rotation, occlusion or real blur. This measures tracker continuity only. It is not recognition accuracy and not evidence about real signers.

## Risks to check on real video

- More observations change the windows the rules see. A previous continuity change (relabelling one frame, 21 October) lost the correct HELLO on `gtsignstudy4a.8033`; this repair adds frames rather than relabelling them, but the baseline gate must confirm the five correct clips.
- More continuous tracking also gives everyday movements more observations. The synthetic negative controls already run with complete tracking and are unchanged (HELLO/THANK YOU risks in `docs/gitex/known-false-accept-risks.json` remain).
- A lost frame now costs one extra hand inference on that frame only.

## Not changed, still open

- On all 11 development clips the research model never received a `ready` segment: the motion gate needs the hand still **and visible** for 140 ms after the movement, and in these clips tracking ends with the movement.
- The app analyses a frame at most every 50 ms; a 30 fps camera then yields one frame per 66 ms (15 per second), where the probe shows more losses.
