# Live ASL recognition: reading the diagnostics

Open the workspace with `?perf` (for example `https://signrelay.web.app/?perf`), choose American Sign
Language and start the camera. Below the timing line, a developer panel shows what each stage of
V3.1 did during this camera session. The panel stays on the device: no image or landmark data is
uploaded or saved. The normal page (without `?perf`) is unchanged.

| Line | What it tells you |
| --- | --- |
| `Tracking N frames (CPU/GPU [+ pose helper]) · to recognizer · hands · shoulders` | The camera is analysed and hands and shoulders are found. Shoulders let the app tell signing from resting. |
| `Signs started · completed · capped at 4 s · too short · skipped` | A sign starts when a hand rises to chest height. It completes when the hands drop below the chest or leave the picture for half a second. "Capped" means signs ran together for 4 s. |
| `Model … runs … failures` | The 523-sign model loaded, and how often it ran. Any load error is shown here. |
| `Strict: accepted · uncertain · unknown · too few hands` | What the Strict policy decided for each completed sign. |
| `Suggestions sent · stale · received · shown · added · spoken` | Whether accepted results reached the page. They are added to the transcript and spoken only after **Add to transcript**. |
| `Last decision …` | The most recent model decision: the top three signs and, if it was rejected, the exact threshold that failed. |
| `Next step` | The first stage that is not working, as one thing to try. |

Typical outcomes, from first stage to last:

- **No camera frames / no hands detected:** a camera, lighting or framing problem. Nothing reached the model.
- **No sign started:** hands never reached signing space (or, with the shoulders out of frame, never
  moved).
- **Signs run together / never finish:** the hands stayed up between signs. Lower them below the chest
  briefly after each sign. Without the shoulders in view a sign ends when the hand stops moving or leaves
  the picture, so pause after each sign or sit back so both shoulders are visible.
- **Strict rejected every sign:** the model ran. The decision line shows whether the right sign was in the
  top three and which threshold rejected it. This is a recognition-accuracy limit, not a broken app.
- **Shown but not added:** working as designed. A suggestion needs **Add to transcript**.

An empty transcript on its own does not mean recognition failed.

`Signs started` counting only 1 per session, with `capped 1`, was a real fault: the signing-space
rule asked whether a wrist was above `shoulders + 1.3 x shoulder width`, which on a desk camera was
true in every frame (61/61 captured), so the first sign ran to the 4 s cap and the segmenter then
waited for a rest that never came. Only the first sign of a session was ever recognised. Signing is
now measured by movement, with signing space deciding only where a sign may begin.

## Saving one sign for offline replay

When a sign is classified but rejected (or accepted as the wrong word), **Save last sign (landmarks
only)** downloads a JSON with the exact 48-frame window the model scored, the policy decision with
its top three and scores, and the stage counters. It contains hand, pose and face coordinates only —
no image, no video, nothing is uploaded.

```bash
node --experimental-strip-types scripts/diagnostics/replay-live-clip.mjs sign.json --label HIGH
```

The replay prints the captured decision, then re-scores the same window with the hand slots swapped,
time reversed, trimmed, and under both Strict and Balanced, and marks the rank of the expected gloss.
That separates three causes that look identical in the panel:

- the expected gloss appears at rank 1 with a lower score: thresholds/miscalibration;
- it appears at a usable rank only after a variant: the live window or slot order is wrong;
- it never reaches the top five: a recognition-accuracy limit for that signer. No threshold change
  can fix that; it needs calibration or training data from real signers.
