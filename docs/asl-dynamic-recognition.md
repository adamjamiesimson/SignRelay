# ASL movement and recovery fixes — 7 September 2026

This change repairs reproducible recognition-pipeline failures. It does not
retrain the WLASL model, establish live sign accuracy, or make SignRelay
foolproof. The checkpoint is still an experimental isolated-sign classifier.

The common-sign checks were informed by ASL University's descriptions of
[HELLO](https://www.lifeprint.com/asl101/pages-signs/h/hello.htm),
[NO](https://www.lifeprint.com/asl101/pages-signs/n/no.htm),
[YES](https://www.lifeprint.com/asl101/pages-signs/y/yes.htm),
[THANK YOU](https://www.lifeprint.com/asl101/pages-signs/t/thankyou.htm),
[PLEASE](https://www.lifeprint.com/asl101/pages-signs/p/please.htm) and
[SORRY](https://www.lifeprint.com/asl101/pages-signs/s/sorry.htm).

## What changed

- The previous HELLO rule required at least 12 frames, a long horizontal wave,
  and a wrist above a fixed screen height. The new common-sign path considers
  650–2600 ms windows, body-relative positions, either dominant hand, and short
  tracking gaps. Pose cues can substitute for a missing face mesh, and a nearby
  body reference prevents a brief pose dropout from changing coordinate systems.
- NO now has an explicit temporal rule for the index and middle fingers closing
  toward the thumb. A one-finger pinch does not satisfy that rule. HELLO, YES,
  THANK YOU, PLEASE, SORRY and I LOVE YOU also have limited fallback recognition.
- ASL research-model segmentation now checks finger articulation as well as
  hand travel. It accepts short completed movements, preserves their beginning,
  and resamples the whole segment instead of truncating to its last 40 frames.
  Idle motion, long tracking gaps and absent current hands do not qualify.
- A confirmed ASL movement is consumed. Holding a recognized static sign does
  not keep adding the same word. Model confirmations still require two fresh
  predictions; stale results and results from previous sessions are invalidated.
- A failed ASL model download can retry after a five-second backoff. Common
  signs and personal recordings remain usable, and the interface explains
  tracking loss and model errors rather than silently showing no match.
- Hand capture is allowed every 50 ms instead of 105 ms, with duplicate video
  frames skipped. Face/pose work is limited to once per 150 ms. These are
  scheduling limits, not measured phone/tablet frame rates.
- Personal matching in all six languages compares multiple time windows. Its
  face/pose feature layout is fixed even during tracking loss, older 17-point
  pose recordings remain readable, and ambiguous different-word templates are
  rejected. Multiple examples of the same word remain supported.
- Camera startup cannot revive a stopped session; partial model startup failures
  release loaded resources. Changing language/word or stopping the camera cancels
  an in-progress personal recording instead of saving under an obsolete choice.

## Evidence and limits

`npm test`: 98 passing tests. `npm run lint`: no errors, two existing Next image
optimization warnings. `npm run build:firebase`: successful static export of
all existing routes, including the generated recognition worker and ONNX runtime
assets. A live phone/tablet camera session was not verified in this environment.

Automated tests cover synthetic movement at several speeds, mirrored dominant
hands, camera framing, landmark jitter, short tracking loss, idle negatives,
one-finger pinch rejection, consecutive signs, held-sign duplicate suppression,
model recovery, resource cleanup and saved-template compatibility. These are
software regression cases, **not samples in a real-sign accuracy percentage**.

One external diagnostic uses ASL University's
[NO reference animation](https://www.lifeprint.com/asl101/pages-signs/n/no.htm),
specifically `no-2-movement.gif` (SHA-256
`d2e0abba36117453786bfda071aa8ac02e6145cbd0ad65fbaca0bf504a8afa1e`).
Its four photographic frames were converted with their animation timing to
20 fps. MediaPipe produced 58 frames with tracked hands. Replaying those same
landmarks through the built workers gave:

| Worker | Candidates | Confirmed output | Extra words |
| --- | --- | --- | --- |
| Previous revision, `1778be9` | None | None | None |
| Updated worker | NO | NO once | None |

This diagnostic was used during development; it is not held-out evaluation.
It is an educational animation, not natural webcam video. Extraction uses the
same task assets and confidence settings with MediaPipe Python 0.10.21; it does
not certify the browser WASM runtime or actual camera behavior. Source images,
videos and extracted person landmarks are not committed or shipped to users.

The fallback rules and their match scores are heuristics, not calibrated
probabilities. They cannot capture all dialects, orientations, facial grammar,
continuous signing or motor variation. THANK YOU and GOOD, among other signs,
need broader contrastive evaluation. No new accuracy claim is made for the
2,000-word ASL classifier or the other five languages. See the earlier
[six-language audit](recognition-audit-2026-09-06.md) for model availability.

## Reproduce a diagnostic locally

Use consented, labeled video kept outside the repository. Put the three `.task`
assets specified in `lib/vision-engine.ts` in a local model directory. Install
`mediapipe==0.10.21` in a separate Python environment. Convert variable-timing
animations to a constant-frame-rate video first (for GIFs, `ffmpeg -i input.gif
-vf fps=20 -pix_fmt yuv420p output.mp4` preserves animation timing).

```sh
python scripts/extract-evaluation-landmarks.py clip.mp4 capture.json --models /path/to/tasks
npm run build:worker
node scripts/replay-landmarks.mjs capture.json NO
```

The replay accepts an optional built-worker path for before/after comparisons.
It uses the actual ASL classifier and confirmation logic, not a mocked model.

Before claiming accuracy, evaluate separate recordings from signers not used
for tuning, including dialect and motor variation, different camera distances,
lighting, phones/tablets, idle hands and similar signs. Count abstentions as
misses; report per-word recall, precision, false confirmations per idle minute,
duplicates and latency. Personal matching needs separate enrollment and test
takes. A failed sign needs its expected meaning and a consensually supplied
recording or landmark capture to diagnose the remaining failure precisely.
