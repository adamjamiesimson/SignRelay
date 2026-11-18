# Owner-operated V2 webcam trials

The local V2 lab is experimental. Run these development trials with a consenting ASL signer who can verify the signs and repetitions they performed. Keep the final holdout reserved. The lab processes frames locally. Leave the browser’s recording and screen capture features off, and keep only the short trial log below.

## Set up

1. Start `node engine-v2/serve.mjs evaluation/raw/hand_landmarker.task` from the repository root and open `http://127.0.0.1:8765` in Chrome. The [lab README](README.md) contains the pinned asset setup.
2. Record the commit, browser version, approximate camera distance and lighting in your local log. Use a session code in place of a name. Note if the browser already has camera permission, since a permission prompt affects startup time.
3. Use **Recent suggestions** to score the emitted sequence. **Recognition** shows the current model window and can change without emitting a word. Open **Diagnostics** for throughput, or read `signRelayCameraDiagnostics()?.startup` in the local console for startup timings.

## Run and score

Press **Start camera** for each scored trial. Wait for **Camera running**, perform the action, then wait two seconds for trailing suggestions before you record the result. Press **Stop** and check that the preview clears. Record the full sequence in order, including any extra word.

| Set | Actions | Expected suggestions |
| --- | --- | --- |
| Isolated | HELLO, THANK YOU, PLEASE, YES and NO individually. Run once at natural speed and once faster, using a comfortable position. | One matching word per trial |
| Repeated | YES then YES, and PLEASE then PLEASE. Include a natural return to rest between performances. Separately try a natural repeat while the hand stays visible and record it as such. | Two matching words per trial |
| Consecutive | YES then NO, and HELLO then THANK YOU, at a natural pace. | Both words, in order |
| Unsupported | CAT and FISH, then a familiar ASL sign outside the five-word vocabulary. | No suggestions |
| Everyday movement | Adjust glasses, reach for an object, scratch your cheek, and rest a hand in view. | No suggestions |
| Conditions | Repeat the five isolated signs at a different comfortable distance or in softer light. | One matching word per trial |
| Recovery | Start and stop during a sign, then start a fresh trial. With a removable camera, also disconnect and reconnect between runs. | No stale suggestion after restart. Score the fresh trial normally. |

Use **correct** for the exact expected sequence, **incorrect** for a different sign on a supported trial, **abstained** when a supported trial emits nothing, **duplicate** for excess matching words, **false accept** when a negative trial emits any word, and **failed** for an interrupted or unusable run. Keep failed runs visible and rerun them as new trials. Count duplicate trials separately even if they also contain a wrong word.

Copy this header into a local text file. Only share the scored rows you choose to provide for review.

```text
session | commit | browser | trial | distance | light | speed | expected | emitted | outcome | analyzed FPS | startup ms | notes
```
