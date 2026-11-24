# Recognition and evaluation in the initial kiosk

The final exhibition release changes the sparse-camera schedule and reports a fresh signer-disjoint comparison in [Exhibition readiness](READINESS.md). The original evidence remains reproducible with the baseline replay mode.

GameShow reuses SignRelay’s pinned Engine V3.1 ONNX checkpoint, MediaPipe version and landmark preprocessing. The upstream November reports describe difficulties with HELLO and YES and confusions such as GOOD versus THANK YOU and EAT versus FOOD. GameShow maintains its own verification policy. [Upstream handoff](https://github.com/adamjamiesimson/SignRelay/blob/1b888fa73aaa6c0d0b0708081f9143fa10c272c9/docs/DEVELOPER_HANDOFF.md) · [November accuracy sprint](https://github.com/adamjamiesimson/SignRelay/blob/1b888fa73aaa6c0d0b0708081f9143fa10c272c9/docs/sprint-2026-11-23/SPRINT_REPORT.md)

## How the verifier works

1. The camera hands one current bitmap at a time to a dedicated worker. MediaPipe tracks both hands and upper-body pose. The worker converts those coordinates into the frozen V3.1 landmark format. Camera frames are discarded after tracking.
2. The app looks at rolling windows of 0.70, 1.15 and 1.80 seconds. A usable window needs six observed hand frames over at least 260 ms, palm-relative movement, and a continuous hand track. It resamples these observations to the model’s 15 Hz input grid. Below eight analyzed frames per second, a sparse window can use three observed frames over at least 510 ms with a larger movement requirement. Live tracking can also reduce image size when throughput stays low.
3. The ONNX worker returns a binary-verification score for the selected target using that target’s temperature-scaled class probability and the cosine similarity to its prototype. It takes the best eligible window. The worker gates out very low target probabilities and strong UNKNOWN evidence. It can accept the target when another class has a higher logit. The score is **0.66 × √p(target) + 0.34 × scaled target cosine**, with the cosine scaled from 0.43–0.88 to 0–1. The probability floor is 0.032 and the UNKNOWN ceiling is 0.75.
4. Confirmation requires two qualifying observations 125–850 ms apart. Each attempt has a unique run ID. Results commit atomically to IndexedDB, using the active participant, challenge, run and deadline as the write condition. A stale match cannot score another round.

**Relaxed is 0.60**, Standard 0.69, Strict 0.79 and Custom 0.40–0.95. These are verifier scores. On the 20 development positives for the selected vocabulary, 0.50, 0.55 and 0.60 each accepted 17. No selected target accepted a wrong development clip at those cutoffs. Retaining 0.60 kept the initial setting with the most headroom within that tied range. The small development cohort cannot establish a false-acceptance bound for the booth. Results below use 0.60. Test-split figures did not change the score threshold or sign list.

## Why these ten signs

Selection used 28 PopSign publisher-validation clips across 14 supported candidates. SORRY was absent from the checkpoint. HELLO and HELP each accepted zero of two. The NO test recordings were unavailable during selection, and EAT had a documented EAT/FOOD ambiguity in upstream replay. YES and THANK YOU were omitted based on earlier recognition issues. Seven selected signs accepted both development clips. STOP, JUMP and ROCK each accepted one and offered memorable motions with available local demonstrations and test data.

| Sign | Reason for selection | Test positives accepted | Other-sign comparisons accepted | Transformed positives accepted | Replay recognition time |
|---|---|---:|---:|---:|---|
| PLEASE | Broad, one-handed circle at chest height | 3/3 | 0/36 | 4/4 | 1.07–1.33 s |
| DRINK | Familiar cup-to-mouth movement | 2/3 | 0/36 | 0/4 | 1.33–2.13 s |
| DRAW | Compact drawing stroke with a clear starting position | 3/3 | 0/36 | 4/4 | 1.07–2.13 s |
| JUMP | Bent fingers mimic a jumping motion | 2/3 | 0/36 | 4/4 | 1.33–2.13 s |
| GREEN | Short flick with a distinct thumb-and-index handshape | 2/3 | 0/36 | 3/4 | 1.07–1.60 s |
| STOP | Distinct stop movement near the center of the frame | 2/3 | 0/36 | 4/4 | 1.33–2.13 s |
| SLEEP | Fingers close as the hand passes down the face | 3/3 | 0/36 | 4/4 | 1.33–2.13 s |
| WHO | Bent index moves near the chin, which gives a clear reference | 2/3 | 0/36 | 4/4 | 1.33 s |
| ROCK | The demonstrated variant taps near the chin | 3/3 | 0/36 | 4/4 | 1.87–2.40 s |
| PENCIL | Lip contact and writing motion give two visible cues | 3/3 | 0/36 | 4/4 | 1.33–1.87 s |
| **Total** | | **25/30** | **0/360** | **35/40** | **1.33 s median** |

- **Correct acceptance on original clips** was 25/30 (83.3%). Five short clips ended without an accept. These were single-attempt clip abstentions. Live 20-second timeout frequency is unmeasured.
- **Wrong-target acceptance** was 0/360 (0% observed) across 39 original recordings. These comparisons reuse a small number of clips, including nine HELLO, HELP and EAT recordings used only as wrong-target inputs. Ordinary real-world assorted movements remain unmeasured. A synthetic empty feed produced no acceptance for any of the ten targets, and automated landmark tests covered inactivity, missing hands and tracking gaps.
- **Alternate inputs** accepted 9/10 mirror, 9/10 dimmed, 8/10 fast and 9/10 slow replays. These transformations reuse one recording per sign and measure image/cadence robustness. Clean versus imperfect beginner acceptance and habitual left-handed signing need live trials. The selected DRINK base clip was already an abstention, and its four transforms all abstained.
- **Low camera cadence** accepted 17/30 positive clips with zero accepts across 360 wrong-target comparisons when sampled at five frames per second. JUMP accepted zero of three in this profile. Treat a sustained low tracking rate on the booth laptop as a reason to test the framing and use host judging when needed.
- **Scrambled motion** produced one acceptance in 100 target comparisons. PENCIL accepted a frame-scrambled version of its own clip. This synthetic control retains authentic individual hand positions and has no independent ordinary-motion performers.
- **Latency** uses simulated clip time from the start of each recording through the first qualifying pair. It includes pre-sign still time and reports neither physical movement onset nor elapsed live-device processing latency. Classifier batches had median 91 ms and p95 164 ms on the test host. The full camera exercise separately verifies the timer and score path.
- **Scope** includes no reranking from test results, no independent booth-camera evaluation and no six-hour physical soak. Get the teaching cues and clip variants checked by a fluent signer before the exhibition. Draw and Pencil use close-looking published variants. Include both in the booth rehearsal alongside DRINK, GREEN and STOP.

## Reproduce

The source package includes the manifest and per-trial evidence under **docs/**. The evaluator uses the same pinned workers, window builder, evidence calculation and confirmation as GameShow, with deterministic frame stepping for the published clips. The Windows Gyan.dev FFmpeg 7.1 essentials build with libx264 produced the pinned MP4s. Set **GAMESHOW_FFMPEG** to an equivalent executable if needed. The recorded validation set includes eight publisher signer IDs and the test set includes nine, with no ID overlap between those two cohorts.

```sh
node scripts/prepare-replay.mjs
node scripts/build.mjs --evaluate
node scripts/evaluate.mjs test-output/fixtures/cohort.json test-output/selection.json --selection
node scripts/evaluate.mjs test-output/fixtures/cohort.json test-output/heldout.json --full
node scripts/evaluate.mjs test-output/fixtures/cohort.json test-output/sparse.json --sparse
node scripts/evaluate.mjs test-output/fixtures/cohort.json test-output/scrambled.json --scrambled
```

For the end-to-end camera replay used for scoring verification, retrieve the pinned SLEEP test clip with the preceding fixture command. Slow it to fit the test host’s camera cadence and transcode it to Chrome’s fake camera format.

```sh
ffmpeg -y -i test-output/fixtures/sleep-test-1.mp4 -an -vf "setpts=1.35*PTS,scale=480:360:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=480:360:(ow-iw)/2:(oh-ih)/2,fps=30,tpad=stop_mode=clone:stop_duration=0.5" -pix_fmt yuv420p test-output/sleep-slow.y4m
node scripts/camera-replay.mjs test-output/sleep-slow.y4m SLEEP STOP 0.65
```
