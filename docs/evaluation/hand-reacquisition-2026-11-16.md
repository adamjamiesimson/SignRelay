# Same-frame hand reacquisition, 16 November 2026

**Status: NOT ADOPTED. Off in production; kept as an evaluation-only tracker option** (`VisionEngineOptions.reacquireLostHands`, default `false`). The shipped tracker behaves exactly as on `main`.

**Why.** The real-video pilot on pull request #61 ([run 43879177811](https://github.com/adamjamiesimson/SignRelay/actions/runs/43879177811)) replayed the development clips with the option on:

- Hand frames on the five additional development clips: 12, 11, 6 and 5 unchanged; the PLEASE clip went from 15 to 16. One recovered frame in 194.
- That frame changed the PLEASE clip from `PLEASE` to `THANK YOU` plus `PLEASE`: a **new wrong word**. The exact-baseline gate failed, as it should.

So the defect below is real for the tracker, and the repair works on the probe, but on these clips the hand is not lost by region tracking: retrying detection on the same image does not find it either. The low hand coverage on the development clips has a different cause, still open. The pilot now replays tracker variants (this option, lower detection/presence/tracking thresholds) on the same clips as a non-gated diagnostic, so the next tracker idea is measured on real video before it reaches the app.

## Defect

MediaPipe's VIDEO mode follows each hand inside the region predicted from the previous frame. When a hand moves far enough between two frames, that region misses it: the frame is returned with **no hand**, and palm detection only restarts on the *next* frame. A fast stroke is therefore observed as `#.#.#.#`.

Every ASL path needs continuous observations (the rules: 5 samples covering 60% of a window; the motion gate and the model: 6). On the 11 development clips the tracker reported a hand in 150 of 414 frames; the YES miss had 5 hand frames and never more than two in a row, the pattern this defect produces. Whether this defect is the cause on those clips is not established until the pilot runs.

## Repair (evaluation option)

When the option is on and the tracker returns no hand on a frame **and had one on the previous frame**, `VisionEngine.process` asks once more for the same image (timestamp + 1 ms). With no region left to follow, palm detection runs on that image. One retry per loss, none while no hand is visible. Every landmark comes from the current camera image: nothing is interpolated, copied from an earlier frame or relabelled, and no detection, presence or tracking threshold changed.

## Evidence (pinned runtime, headless Chromium, software rendering)

`node scripts/diagnostics/hand-reacquisition-probe.mjs <chrome> docs/evaluation/hand-reacquisition-2026-11-16/probe.json` moves three public MediaPipe test photos (thumb up, fist, two open hands) across a canvas with motion blur, at 0–1500 px/s, 50 and 66 ms frame intervals, and compares the production call pattern with the option on. Full rows: [`probe.json`](hand-reacquisition-2026-11-16/probe.json).

| 42 moving runs, 2,520 frames | Before | After |
| --- | ---: | ---: |
| Frames with a hand | 2,441 | 2,518 |
| Runs with at least one dropped frame | 14 | 2 (both miss only the very first frame, before any hand was tracked) |
| Retries / recovered | n/a | 92 / 89 (the other 3 are the photo really leaving the frame) |
| Hand frames after the photo left, or in an empty scene | 0 | 0 |

Slow or still hands (0–300 px/s) were never dropped, before or after. Losses start at 600–1000 px/s and are worse at 66 ms than at 50 ms intervals.

**Limits.** A translated photograph is not a signer: no handshape change, rotation, occlusion or real blur. This measures tracker continuity only. It is not recognition accuracy and not evidence about real signers.

## Still open

- Hand coverage on the development clips (150 of 414 frames) is unexplained. Candidates not yet measured on real video: palm-detection threshold, clip resolution and framing, motion blur at the source frame rate.
- The app analyses a frame at most every 50 ms; a 30 fps camera then yields one frame per 66 ms (15 per second), where the probe shows more region-tracking losses.
