# Live recognition (ASL V3.1 and BSL): reading the diagnostics

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
- **No sign started:** hands never reached signing space.
- **Signs run together / never finish:** the hands stayed up between signs. Lower them below the chest
  briefly after each sign.
- **Strict rejected every sign:** the model ran. The decision line shows whether the right sign was in the
  top three and which threshold rejected it. This is a recognition-accuracy limit, not a broken app.
- **Shown but not added:** working as designed. A suggestion needs **Add to transcript**.

An empty transcript on its own does not mean recognition failed.

## British Sign Language (BSL)

Choose British Sign Language with `?perf`. The panel shows the BSL pipeline instead:

| Line | What it tells you |
| --- | --- |
| `BSL legacy|v2 · tracking · to recognizer · hands · shoulders` | Which input adapter is active, and whether hands and both shoulders are visible. The body-wrist hand assignment needs the shoulders and wrists in view. |
| `Signs completed · skipped (model busy)` | A BSL sign completes when the hands have moved and then hold still for about a quarter of a second. Each completed sign is checked once. |
| `Model … runs … failures` | The 1,064-sign BSL-1K model (downloaded when BSL is selected) and its last run time. |
| `Decisions: accepted · uncertain · too few hands · no movement` | What the confidence policy decided for each completed sign. |
| `Suggestions sent · stale · duplicates suppressed · received · shown · added · spoken` | BSL words are suggestions: they reach the transcript and speech only after **Add to transcript**. |
| `Last BSL decision …` | Top three signs, how many 16-frame windows were scored, frames in the sign, hand frames, and how often the body-wrist check corrected the tracker's left/right hand label. |
| `Next step` | The first stage that is not working, as one thing to try. |

BSL recognition accuracy is unmeasured on real BSL video and on physical cameras. See
`docs/bsl-sprint-2026-11-24/` for the audit, protocol and rehearsal procedure.
