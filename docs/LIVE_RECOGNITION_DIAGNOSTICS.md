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

## The shipped gate: `policy-top1.json`

The booth now publishes the argmax: no confidence or prototype floor, so the top-1 label is shown
whenever a sign completes. Measured on one live signer's eight captured signs (the window the app
actually builds, margins included):

| gate | signs published | of which correct | probes with destroyed hand geometry published |
|---|---|---|---|
| strict | 4/8 | 4 | 0/32 |
| demo (0.70 / 0.55 / 0.30) | 6/8 | 6 | 0/32 |
| **top1** | **8/8** | **7** | **32/32** |

That last column is the trade: with no floor, any movement that completes a segment publishes a word
- scrambled hand geometry scores under `max_unknown` too, so nothing else catches it. The transcript
is where a wrong word gets corrected, and `min_hand_frames` plus `max_unknown` are all that is left.
`policy-demo.json` (6/8, nothing from a wave) is one constant away in `ASL_V31_POLICY`.

## The previous gate: `policy-demo.json`

Strict (`min_top1 0.847`, `min_proto 0.812`) was fitted on PopSign validation signers. A signer who
learns the sign on the spot does not reach it: measured on one live signer's captures with the right
gloss at rank 1 seven times out of seven, Strict accepted **3**. Booth mode therefore ships
`policy-demo.json` (`min_top1 0.70`, `min_proto 0.55`, `min_margin 0.30`, `max_unknown` unchanged),
selected by `ASL_V31_POLICY` in `lib/asl-v31-assets.mjs`.

| gate | correct windows accepted | probes with destroyed hand geometry accepted |
|---|---|---|
| strict | 3/7 | 0/42 |
| demo | 7/7 | 0/42 |

So the looser bars admit this signer's own signs without admitting incoherent input. What they do
accept is a *partial* sign (2 of 12 windows cut to 0.6 s) and the same pose in a scrambled order -
both of which show the sign. It is not a calibration: no unknown-sign set was measured, so treat
`min_top1`/`min_proto` as a booth decision, not an accuracy claim. Revert by setting
`ASL_V31_POLICY` back to `"strict"`.

The 4 s segment cap was also wrong for this case. One captured HIGH scored 0.809 (rejected) over its
4 s window and 0.987 (accepted) over its first 2.5 s, because a hand that keeps moving after the sign
stays in the window. `MAX_SEGMENT_MS` is now 2500.

## Reading a panel that is not in the copy

Two parts of the panel were written into the text instead of read from the build: the gate row said
`Strict:` and the segment row said `capped at 4 s` while the app shipped `policy-demo` and a 2.5 s
cap. Both now come from `ASL_V31_POLICY` and `MAX_SEGMENT_MS`, so a panel can no longer name a
threshold or a duration the build does not use - which cost a debugging round when a rejection was
attributed to Strict.

A high `capped` count is not a fault on its own: a signer whose hands keep moving between signs never
shows a rest, so the cap closes the segment. Raising the movement threshold does not fix that - it was
replayed at 0.012-0.030 on seven captured signs and the clips barely changed, while HELLO's score fell
from 0.49 to 0.46. The useful lever is `MAX_SEGMENT_MS`.

## Checking the model on video it never saw

`scripts/diagnostics/video-to-features.py` decodes any video, runs the same MediaPipe tasks the
browser runs, and writes the same 86-point rows, so the shipped model can be scored on a stranger's
footage without a dataset:

```bash
pip install mediapipe opencv-python
python3 scripts/diagnostics/video-to-features.py clip.mp4 out.json
node --experimental-strip-types scripts/diagnostics/replay-live-clip.mjs out.json --label PLEASE
```

Measured on twelve public per-word clips (different signers, cameras and studios), top-1:

| sign | videos | correct top-1 | note |
|---|---|---|---|
| PLEASE | 3 | 3 | 0.94 / 0.98 / 0.60, prototype 0.86-0.93 |
| YES | 2 | 2 | 0.81, 0.69 |
| WATER | 2 | 2 | 0.94, 0.60 |
| THANK-YOU | 2 | 0 | YUMYUM 0.50, HEAD 0.54; THANK-YOU reaches rank 1 only reversed |
| STOP | 2 | 0 | SINK 0.61, OVEN 0.23 |
| HELLO | 1 | 0 | a 42 s greetings compilation, not a single sign - not a fair test |

So the input contract generalises: an unseen signer's PLEASE, YES and WATER are read correctly from a
downloaded video. THANK-YOU and STOP fail the same way the signer's own MORE failed, and the videos
show why: the variant being taught is not the one the PopSign-trained head learned, and no window,
mirror or time variant recovers it. That is a vocabulary-coverage limit, not a pipeline fault, and it
is the reason teaching those signs as personal examples is the reliable route.

Downloading video for **training** is a different question. It is how WLASL was built, and this repo
ships the official WLASL-2000 Pose-TGCN checkpoint: on the same captured windows it answered PLEASE
with SNOWMAN 0.87 and YES with AUDIOLOGIST 0.91. More YouTube data does not by itself beat a
better-matched smaller model; matching the signer does.

## Ideas that were measured and rejected

Accuracy work has an obvious list; most of it does not help, and each of these was scored on
twenty labelled clips (the signer's own captures plus twelve public per-word videos):

| idea | result |
|---|---|
| average several windows of the segment | no change to top-1 (7/8 either way) |
| pick the most confident sub-window | neutral overall and worse in kind: THANK-YOU fixed 0.54 -> 0.97, YES broken 0.69 -> HAVETO 0.89 |
| raise the movement threshold to end signs sooner | clips barely shortened, HELLO fell 0.49 -> 0.46 |
| assume hand-slot flapping from MediaPipe handedness | the signer's own clips flip a slot 0-2 times per clip, not per frame |
| smooth or re-interpolate the 15 Hz grid | `resampleTo15Hz` already interpolates between samples |
| switch to the WLASL-2000 YouTube-trained checkpoint | PLEASE -> SNOWMAN 0.87, YES -> AUDIOLOGIST 0.91 |

The pattern: the model's top-1 is stable under everything that does not change *which sign* it sees.
What moves accuracy is which examples the system has of *that signer*.

## Keeping a taught dictionary honest

Two ways a growing personal vocabulary silently degrades, both now reported at the moment of
recording rather than discovered later at a booth:

- **takes that disagree**: the new take is compared with the word's earlier takes; below 0.6 the
  panel says so instead of pretending the sign is ready (measured repeats of one sign: 0.93).
- **takes that collide**: the new take is compared with every *other* taught word; at or above the
  matcher's own 0.75 bar the two can never be told apart, and the matcher would abstain silently.

Several takes of one word are also pooled into a centroid, so one loose recording cannot outvote a
good one, and when a word reaches its limit of three examples the take that agrees least with the
others is dropped rather than the oldest.

## Fitting a policy to real signers

The Strict gate is fitted on PopSign validation signers, so a live camera can produce the correct
gloss at rank 1 and still be rejected (measured: 4/5 correct, Strict accepted 1). Saved captures are
enough to fit the gate to your own camera, because the model's scores are already extracted:

```bash
# labels.json maps a capture file name to the gloss that was signed, or "UNKNOWN"
node --experimental-strip-types scripts/diagnostics/fit-live-policy.mjs captures/*.json \
  --labels labels.json --max-false-accept 0.10
```

It prints the per-capture scores, what Strict and Balanced accept, and the best threshold rule within
the false-accept budget — then refuses to write a policy below 40 signed and 15 not-supported
captures, because a rule fitted to a handful of windows measures nothing. `--out policy-live.json`
writes it once that bar is met (`--force` overrides, development only).

Not-supported captures matter as much as signed ones: use signs the vocabulary does not cover, or an
invented movement, and confirm the panel shows a decision so the window is recorded.
