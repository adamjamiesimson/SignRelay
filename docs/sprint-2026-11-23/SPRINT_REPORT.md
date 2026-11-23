# Accuracy sprint 2026-11-23: V3.1 recognition in the integrated app

Branch `claude/happy-feynman-w16gax`, [PR #68](https://github.com/adamjamiesimson/SignRelay/pull/68).
Baseline: `c5c802df4728a5bff848d2cb47a423c8b06df241` (main after PR #67). No newer remote work existed
when the sprint started. The protocol and frozen cohort were committed before any candidate ran:
[PROTOCOL.md](PROTOCOL.md), [development-cohort.json](development-cohort.json).

**Everything below is fake-camera file replay or offline replay of publisher-labelled development
clips on a cloud CPU. None of it is physical live-signing accuracy.**

## Result

V3.1 Strict and manual confirmation are unchanged. The candidate is `37ecdfa`; the evidence is in
[evidence/replay/](evidence/replay/).

| Integrated app, fake camera (one run each) | Supported | Correct | Wrong | Abstained | Unknown false accepts | Grey-gap accepts | Forwarded fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| shared: baseline → candidate | 17 | 10 → 10 | 0 → 0 | 7 → 7 | – | 0 → 0 | 11.7 → 13.9 |
| broad | 12 (+4 unknown) | 2 → 2 | 2 → 2 | 8 → 8 | 0/4 → 0/4 | 0 → 0 | 11.0 → 13.8 |
| A (diagnosis/tuning) | 30 (+10 unknown) | 15 → 18 | 0 → 0 | 15 → 12 | 2/10 → 2/10 | 0 → 0 | 11.5 → 13.5 |
| **B (confirmation, untouched until final)** | 30 (+10 unknown) | **7 → 12** | 0 → 0 | 23 → 18 | 0/10 → 0/10 | 0 → 0 | 11.4 → 13.3 |
| **Total** | 89 (+24 unknown) | **34 → 42** | 2 → 2 | 53 → 45 | 2 → 2 | 0 → 0 | |

Across all four replays there were no runtime errors, duplicate accepts, leaked camera tracks, or
transcript/speech output without confirmation. The pre-registered adoption rule passed on
shared+broad+A: +3 correct, no added errors, higher fps. B then confirmed it with +5.

Per-trial changes:

- Became correct: HELLO (shared), WHO, ROCK, SNOWSUIT (A), and SODAPOP, DRAW, PENCIL, SLEEP, JUMP (B).
- Regressed: one borderline trial, `dev-yes-4a.8006`, went from correct to abstained. It also abstained in a captured baseline run.
- No trial became wrong.

Remaining wrong outputs, all counted wrong under strict labels:

- EAT → FOOD
- GOOD → THANK-YOU
- ASLEEP → SLEEP (unknown sign)
- OVER → AFTER (unknown sign)

Whether these pairs count as equivalent is a separate linguistic-review question, and the scoring has not been changed for it.

Single runs vary by about ±1 sign per reel. The total gain (+8 of 89) is larger than that, but it is still
a small development sample from validation signers that were already used for V3.1 model selection.
The shared, broad and A reels are now tuning-contaminated.

## What was wrong

### 1. Analysed frame rate, the dominant pipeline loss

I recorded the landmark observations the integrated recognition worker actually received, and ran
native MediaPipe 0.10.35 (the training extractor's version) on every frame of the same reels. I then
replayed both through the real segmenter, model and Strict policy offline
(`scripts/diagnostics/offline-v31-replay.mjs`). Offline replay of the browser's own observations
reproduces the browser outcome trial for trial.

| Same reels (shared+broad+A, 59 supported) | Correct | Wrong |
| --- | ---: | ---: |
| Browser baseline observations (~11.5 fps overall, ~10 Hz while hands visible) | 26 | 2 |
| Native, every 2nd frame (7.5 Hz), pose every 2nd | 25 | 3 |
| Native 15 Hz, pose every frame / 2nd / 3rd / 4th | 35 / 34 / 32 / 32 | 2 / 2 / 2 / 1 |

Within signing intervals the hand-detection fraction is about 0.40 at every cadence, so tracking
quality and continuity are not the problem. The loss comes from having fewer real observations per
sign. Timing captured inside the tracker showed that on this CPU the hand landmarker takes about
61 ms with one hand visible (about 34 ms with none). Pose (about 30 ms) and face cues (about 20 ms)
ran after it on the same worker. Cadence therefore fell to about 10 Hz exactly while signing. The
camera interval is 66.7 ms. Capture and transfer overhead was only about 2 ms.

The face landmarker was an integration-only cost. V3.1 is face-free and the reference lab never
runs it. The integrated tracker sampled face cues every 150 ms (for the overlay, framing indicator
and personal templates), sometimes on the same frame as pose.

### 2. Policy abstention: the largest remaining loss, deliberately not changed

Even with ideal 15 Hz observations, 18 supported trials had the correct top-1 but were rejected by
Strict. The rejection usually came from the prototype-similarity gate: correct signs scored 0.64–0.81
against a threshold of 0.812. The observed wrong answers all have high prototype similarity
(0.85–0.95), so this gate is not what stops them. Rejected unknown signs score in the same
0.66–0.81 range as the correct abstentions.

On C2's identical observations (shared+broad+A), Balanced would give 37 correct with 3 wrong and 5
unknown false accepts, against Strict's 29 / 2 / 2. That is +8 correct for double the errors. Fourteen
unknown intervals and no ordinary-motion footage cannot justify a lower threshold, so Strict stays.

### 3. Segmentation

With no grey gaps between clips (back-to-back reels), native observations lose only one sign per reel
to merging. That is 1 of 17 on shared and 1 of 30 on A, because PopSign signers lower their hands
out of view between signs.

The logic does have a physical failure mode that these clips cannot show. A sign stayed open while
*any* hand was visible. Hands resting visibly low in frame therefore held a segment to the 4 s cap.
After a capped segment the integrated app waited for the hands to leave the frame entirely, which
could stall recognition.

### Ruled out

- **Tracking-gap evidence resets:** zero across all captures.
- **Duplicate or grey-gap accepts:** none.
- **Capture and transfer overhead:** about 2 ms per frame.
- **Preprocessing and model execution:** offline replay of the browser's observations matched the browser exactly.
- **Startup:** click-to-active stayed at 0.6–0.7 s.

## What changed

1. **Face cues** (`workers/asl-v3-tracker.worker.ts`) now run at most every 400 ms and never on a pose
   frame. The existing 750 ms carry-forward keeps face cues on every frame for the overlay, framing
   and personal templates.
2. **Parallel pose worker** (`lib/asl-v3-tracker.ts`). On machines with 4 or more logical cores, a second
   worker instance tracks pose at the lab-validated every-second-frame cadence, in parallel with
   hand tracking, and the client merges the newest pose (at most 750 ms old, same generation) into
   each hand frame. If the pose worker fails, stalls for 2 s or misses its 60 s startup, the app
   falls back to in-worker pose without a camera error. Reset discards earlier pose.
   - C1 (face change only): 29 correct / 1 wrong / 2 unknown false accepts, 11.9–12.6 fps.
   - C2 (C1 + pose worker): 29 / 2 / 2, 13.4–13.7 fps.
   - Captured baseline: 26 / 2 / 2.
   - Hand-landmarker time rose only from 61 to 63 ms under contention.
3. **Rest-aware sign ends** (`lib/asl-v31-segmenter.ts`). A sign now ends, and the rest required after a
   capped segment is now satisfied, when hands are absent *or below signing space* for 500 ms. This
   uses the same shoulder rule that already opens a segment. Without shoulders the behaviour is
   unchanged. Identical outcomes on 11 recorded observation sets. The benefit (hands resting in
   view) is **not yet measured**.
4. **Diagnostics:**
   - per-task tracker timings;
   - observation capture in the replay harness (`CAPTURE_OBSERVATIONS`);
   - offline identical-observation replay;
   - a native MediaPipe reference;
   - back-to-back reels (`--gap-frames 0`);
   - a deterministic cohort selector;
   - a result summarizer.

No model, vocabulary, threshold, label or UI copy changed. The 523-class engine is unchanged. Non-ASL
pipelines do not use the V3.1 tracker or segmenter.

## Verification actually executed (candidate source `37ecdfa`; later commits change only docs and tests)

| Check | Result |
| --- | --- |
| `npm run typecheck`, `npm run lint`, `npm run repo:guard`, `npm run build:worker` | passed |
| `npm test` | 944 passed, 1 optional skipped (93 files). Includes 4 new pose-worker and 3 new rest-aware segmenter tests. |
| `npm run audit:security` (npm audit, secret scan, rendered HTML) | passed, 0 findings |
| ASL demo export, `verify-runtime --profile asl-demo` | passed. Committed recognition worker matched; model `b3e05424…`, Strict. |
| `demo:check` (deny-all proxy, offline startup and model load), offline self-test, offline vision, V3.1 ONNX probe | passed |
| Lifecycle stress, 60 s sustained | passed: 12 start/pause cycles, rapid toggles, hidden tab, processing failure, tracker crash and retry, **pose-helper crash falls back without a camera fault**, ended track, 3 leave/re-enter cycles, pagehide, 610 frames in 60 s with heap 5→6 MB. Other smokes ran at the same time, so its fps is not a clean measurement. |
| Fault injection (missing/corrupt assets, worker faults, storage failures) | passed |
| Workspace smoke on a **full-profile build without the blocked Slovo weights** | passed: V3.1 manual-review gate for transcript and speech, duplicate/stale suggestion suppression, transcript isolation, persistence and storage failures, queued speech, denied/late camera permission |
| Model lifecycle smoke (asl/bsl/isl/lse), BdSL and Spanish browser smokes | passed |
| Engine 1 rehearsal and transcript accessibility smokes (rehearsal profile) | passed |
| axe WCAG (5 pages and active workspace) | 0 violations |
| Visual parity, baseline vs candidate ASL-demo export (desktop and mobile, landing and workspace) | all 4 screenshots byte-identical |

Logs: [evidence/verification/](evidence/verification/). Not run here: the full `build:firebase` export (the Slovo host is blocked) and the Russian browser smoke. GitHub CI runs the full build.

## Limitations

- **Hardware:** a cloud CPU (4 vCPU, software WebGL, Chrome for Testing 153). A booth laptop with a GPU
  delegate may already reach 15 fps, in which case the cadence fix matters less there. A weaker
  laptop gains more. A 2-core machine keeps the old single-worker path.
- **Fake camera:** the camera was a 15 fps fake camera. Real webcams are usually 30 fps.
- **Reel hashes:** the shared and broad reels were rebuilt from the same pinned clips, but their Y4M
  hashes differ from PR #67's (different ffmpeg). The baseline still reproduced: shared 10/0/7 and broad
  2/2/8, matching the recorded numbers.
- **Unmeasured:** ordinary non-sign movement, physical cameras, independent signers and hands resting
  in view.
- **Full export:** this environment's network policy blocks the Slovo model host (403), so the full
  multi-language export (`build:firebase`) could not be built here. All checks used the ASL-demo profile.

## Reproduce

```bash
python3 scripts/diagnostics/select-sprint-cohort.py /tmp/cohort.json   # re-derives the frozen selection; the committed file is authoritative
python3 scripts/diagnostics/build-engine-comparison-reel.py docs/sprint-2026-11-23/development-cohort.json work/reels/A.y4m work/reels/A-truth.json --cohort A --fetch-validation
npm run demo:prepare && npm run demo:serve -- --port 4304 &
node scripts/diagnostics/run-engine-comparison.mjs "$CHROME" http://127.0.0.1:4304 work/reels/A.y4m work/reels/A-truth.json integrated-v3 work/results/cand-A.json
python3 scripts/diagnostics/summarize-replays.py work/results/cand-*.json
```

`--fetch-validation` downloads only the pinned validation clips. Baseline: check out `c5c802d` in a
separate worktree and run the same commands.

Identical-observation studies:

```bash
CAPTURE_OBSERVATIONS=work/results/cand-A.obs.json node scripts/diagnostics/run-engine-comparison.mjs …
node --experimental-strip-types scripts/diagnostics/offline-v31-replay.mjs work/results/cand-A.obs.json work/reels/A-truth.json [--policy balanced] [--segmenter '{"restAware":false}']
python3 scripts/diagnostics/native-reel-observations.py work/reels/A.y4m work/results/n15-A.obs.json --rate 15 --pose-every 2   # needs mediapipe==0.10.35
```

Raw reels, videos and landmark captures stay in ignored `work/` and `evaluation/videos/`.

## Next steps

1. **Booth hardware.** Read the `?perf` line ("Tracking p50/p95 · forwarded/s") on the event laptop and
   webcam, with hands visible. If forwarded/s is well below 15, try the GPU delegate, close other
   apps, and prefer a machine with at least 4 cores.
2. **Physical checklist.** Run [PHYSICAL_TEST_CHECKLIST.md](../showcase-2026-11-26/PHYSICAL_TEST_CHECKLIST.md).
   Include hands resting *in view* between signs, which tests change 3, and ordinary movement.
3. **Unknown and ordinary-motion data.** Collect consented ordinary-motion and unknown-sign recordings
   before any policy change. Strict's recall loss is the largest remaining lever, and it can only be
   recalibrated against an adequate rejection set.
4. **Linguistic review.** Get fluent review of EAT/FOOD, GOOD/THANK-YOU, ASLEEP/SLEEP and OVER/AFTER.
