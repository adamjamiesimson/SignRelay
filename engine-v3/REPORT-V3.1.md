# SignRelay Engine V3.1 — engineering report

Scope: make the 523-class V3.0 recognizer work end to end through real video processing, find out why
camera replay underperformed, and improve the model without changing the vocabulary. The V3.0 model and its
original sealed reports are preserved unchanged (`models/v3.0/`, `ledger/sealed-v3.0/`). Every number below
comes from `ledger/experiments.jsonl` or a report next to it.

## 1. CI status

| Check | Before (`7d83de2`) | After (`3387288` onward) |
| --- | --- | --- |
| Core CI (typecheck, test, lint, worker, repo guard, `audit:deps`) | ❌ failure: 11 advisories | ✅ success |
| Firebase Static Build Check (build + strict dependency audit release gate) | ❌ failure | ✅ success |
| Offline ASL demo / rehearsal / fault-injection smokes | ✅ | ✅ |
| ASL video pilot | — | ✅ |

**Root cause:** newly published advisories against locked versions: `next` 16.4.2 (7 moderate),
`@vitest/mocker` ≤ 4.1.11 (2), `minimatch` 7–11.0.0 via `typescript-eslint`, and `zod` < 4.6.6 (high).
**Fix:** patched releases within the same majors: `next`/`eslint-config-next` 16.4.6, `vitest` 4.1.12,
`zod` 4.6.7, current `typescript-eslint` 8.x and `minimatch` 11.0.9. `npm audit` now reports 0, and the strict
`audit:deps` policy is unchanged (no new exceptions). npm 10's arborist crashed on this tree's peer set, so the
lockfile was regenerated with npm 11, and I verified that npm 10 `npm ci` installs it as CI does.
This branch is now excluded from automatic Vercel deployments, so the production Vercel project no longer
builds previews of it. That follows the V2 precedent `863d2c0`.

## 2. Root causes of the camera failures

**Causal diagnostic** (`parity/camera_diagnostic.py`; 5 development reels, 60 supported signs, 8 *validation*
signers; frozen V3.0 model; no test data reused). The same intervals pass through progressively more
realistic stages:

| Stage | Top-1 correct | Accepted & correct |
| --- | ---: | ---: |
| S1 isolated clip, native offline | 45 | 32 |
| S2 + webcam geometry / re-encoding | 43 | 31 |
| S3 + camera frame timing (8–10 fps) | 43 | 31 |
| S4 + Chrome tracking / pixels | 40 | 28 |
| S5 + live segmentation | 39 | 27 |

* Of the 33 accepted-correct results missing at S5, **28 are already missing offline**: 15 wrong top-1 and
  13 correct but abstained. Camera geometry, frame timing, browser tracking and segmentation together cost
  about 5. Chrome and native hand presence align 95–98 % after clock alignment.
* **Earlier V3.0 sealed-reel failure (8/30):** the V3.0-era segmenter fragmented signs and cut the classified
  window shorter than in training. Segmenter v2 (any-hand continuation, 500 ms gap, training-matched window) fixed this.
* **Frame rate is not the dominant cause.** Simulated camera cadence on 2,339 validation clips gives 77.6 %
  top-1 at 15 Hz, 75.3 % at 12 fps, 74.9 % at 10 fps, 73.8 % at 8 fps and 70.7 % at 6 fps.
  Low-frame-rate augmentation in training already absorbs most of it.
* **Dominant causes:** model accuracy (lexical-neighbour confusions, § 6) and conservative abstention. Even at
  15 Hz offline, only 57.5 % of known signs are accepted correctly despite 77.6 % top-1.
* **Throughput anatomy** (headless Chrome, 4 vCPU, CPU-only): frame interval 100 ms. The hand landmarker
  costs 91 ms when hands are visible versus 46 ms without (one landmark pass per tracked hand plus palm
  detection), and is the critical path. Pose costs 32 ms. 15–18 % of frame intervals exceeded 150 ms
  because classification ran on the tracking worker.
* **Dim or distant video** (V3.0 robustness study) is a landmark-resolution problem. At 960 px the zero-hand
  clips fall 14 → 0 (far) and 21 → 2 (dark), and the frozen model recovers to 70 % and 62.5 %.
  For webcam input the palm detector downsamples internally: 480 versus 640 px made no measured difference
  on the reels.

## 3. Improvements implemented

| Change | Evidence | Status |
| --- | --- | --- |
| Segmenter v2 (signing-space open, any-hand continuation, 500 ms gap, ±600 ms training-matched window) | Validation reel: 6/12 → 7/12 correct, 0 wrong | default |
| Camera analysis at native resolution (cap 960 px) | No loss; helps small or dim hands per the diagnostic | default |
| **Dedicated classifier worker** (ONNX off the tracking worker) | Removes classification stalls from tracking | default |
| **Pose every 2nd camera frame** (carry-forward) | Simulation: no top-1 cost at 12 fps; A/B 29 vs 28 correct, **~12.0 vs ~10.3 fps** | default |
| Automatic CPU/GPU MediaPipe delegate probe at startup | GPU cannot be measured here (software GL: 396 ms/frame) | default (`?delegate=cpu\|gpu` overrides) |
| Parallel hand/pose workers | Microbenchmark 72.6 → 45.3 ms/frame on blank frames, but **no live gain** (23 vs 27 correct; hand tracker slows under contention) | opt-in only (`?split=1`) |
| Learned acceptance model (logistic regression on 7 scores) | Signer-grouped CV: within ±3 points of the current rule | rejected |
| Test-time augmentation (mirror, speed) | +0.1 point top-1 | rejected |
| Class-balanced loss (weights ∝ (median/count)^0.5) | Controlled pair of seeds: 80.5 % vs 80.0 % val top-1; the two are ensembled | in V3.1 model |
| More training data (tranche D: +5,711 clips; ~37 clips/class) | V3.0 → V3.1: +1.9 top-1 on holdout-2 PopSign, +2.0 on ASL Citizen | in V3.1 model |
| Latest-frame scheduler (process the newest frame that arrived while busy, instead of waiting a full camera interval) | Dev reel 2 (12 signs): 15 fps camera 8.0 → 9.0 analysed fps, 7 → 9 correct, 1 → 0 wrong; 30 fps camera 13.7 → 14.7 fps, 9 → 9 correct, 1 → 0 wrong | default (`?latest=0` restores the old scheduler) |

## 4. Browser replay before and after

**Cohort:** four camera reels built only from holdout-2 PopSign clips (test round 1; never used before).
Each reel has 14 intervals: 48 supported signs (including deliberate repeats), 4 signs outside the 523
vocabulary and 4 FSBoard fingerspelling windows. The reels were fed to headless Chrome as a fake webcam
(`parity/chrome-camera-replay.mjs`, 640×480 at 30 fps) and scored by `parity/score_reel.py`. Each build was run
once (`ledger/camera-v3.1/`).

| Build | Correct | Wrong | Abstained | Missed | Unsupported accepted | Analysed fps |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Before: V3.0 model + V3.0-era app | 27 / 48 | 1 | 20 | 0 | 1 / 8 | 11.0–11.7 |
| **After: V3.1 model + V3.1 app** | **35 / 48** | **0** | 13 | 0 | 2 / 8 | 12.3–14.3 |

Neither build produced a segmentation gap or a duplicate acceptance. The earlier V3.0 sealed-reel result
(8/30) was largely the old segmenter. The development-reel A/B in § 3 separates the app changes from the
model change. With the frozen V3.0 model, the app alone went from 27 to 29 correct (4 wrong in both arms);
the remaining gain comes from the V3.1 model.

## 5. Analysed FPS and latency

Headless Chrome on a 4-vCPU container with CPU-only MediaPipe. GPU is not measurable here: the only WebGL
is SwiftShader, at 396 ms per frame. Real laptops with GPU WebGL should be faster, which is unverified.

| Measurement | Value |
| --- | --- |
| Analysed rate, 30 fps camera (target 15) | ~10.0 baseline → ~12.0 with classifier worker and pose cadence 2 → 12.3–14.3 on holdout reels |
| Hand landmarker per frame | 50–60 ms (critical path; ~2× when two hands are tracked) |
| Pose per frame, cadence 2 | 12–16 ms amortised |
| Classification, off the tracking thread | median 31 ms |
| Sign end → result | 500 ms segment-close gap + ~30–60 ms classification |
| Lab startup (assets verified, models warm) | 2.0 s normal; 14 s under heavy CPU contention |

**Device and sampling sweep** (development reel 2, 12 supported signs, V3.1 lab):

| Camera configuration | Correct | Wrong | Analysed fps |
| --- | ---: | ---: | ---: |
| 640×480 @ 30 | 8 | 2 | 12.0 |
| 320×240 @ 30 | 8 | 1 | 15.0 |
| 1280×720 requested (the fake device delivered 640×480) | 8 | 1 | 12.7 |
| 640×480 @ 15, old skip-while-busy scheduler | 9 | 2 | 8.0 |
| 640×480 @ 15, latest-frame scheduler (adopted) | 9 | 0 | 9.0 |
| DevTools CPU throttle 2× / 4× (main thread only; workers unthrottled) | 9 / 8 | 0 / 0 | 13.3 / 11.3 |

**Scheduling flaw found by the sweep:** with a 15 fps camera, tracking (~60–80 ms) plus the old
skip-while-busy rule dropped every frame that arrived during work, halving the rate. The latest-frame
scheduler keeps the newest frame that arrived while busy and processes it as soon as the tracker frees.
It still respects the 15 Hz cap.

Paired A/B on the same reel:

| Camera | Old scheduler: correct / wrong / fps | Latest-frame: correct / wrong / fps |
| --- | --- | --- |
| 15 fps | 7 / 1 / 8.0 | 9 / 0 / 9.0 |
| 30 fps | 9 / 1 / 13.7 | 9 / 0 / 14.7 |

It is adopted because throughput rose with no accuracy loss. Twelve signs per arm cannot show an accuracy
gain. Separate runs of the same configuration vary by about ±1 sign and ±1.5 fps with host load: compare the
12.0 fps sweep row with the 13.7 fps old-scheduler arm.

Rule followed: a higher frame rate counts only when accuracy holds. The split hand/pose workers raised
microbenchmark throughput but cost accuracy live, so they stay opt-in.

## 6. Accuracy, unknown-sign rejection and error types

**Validation** (PopSign val, 9 signers, 2,339 clips; used for model selection and policy fitting):
V3.1 top-1 81.4 %, top-5 96.1 %, macro recall 81.5 %. With the balanced preset, 64.2 % of known signs are
accepted correctly, precision is 94.9 %, 3.4 % are accepted wrongly, and FAR on calibration unknowns is 26.3 %.
The strict preset gives precision 96.4 % at 52.1 % accepted correct.

Known-sign accuracy and unknown false accepts on the untouched holdout-2 are in § 7. They are always reported
together.

**Rejection changes in V3.1:** 600 FSBoard fingerspelling windows were added to training as UNKNOWN, and
presets are fitted to an explicit FAR target. Results:
* Fingerspelling: 0 / 300 false accepts on FSBoard test (both presets).
* Out-of-vocabulary signs: ASL Citizen balanced FAR 15.0 %, strict 5.3 %.
* PopSign unseen signs: balanced 29.2 %, strict 22.9 %. Only 48 clips, so the 95 % CI is roughly ±13 points.

The learned acceptance model (§ 3) did not beat the rule. **Unknown rejection remains the weakest part**, see § 10.

**Error types (V3.0, validation):**
* *Mutual near-identical or variant signs:* AWAKE↔WAKE, DEER↔MOOSE, WERE↔WAS, GENTLE↔SOFT, CAN↔COULD,
  GIFT↔PRESENT, BROKEN↔BREAK. These are label-variant ambiguity, not model failure. The vocabulary stays frozen.
* *One-way absorption, partly a class-prior effect:* BENCH→COUCH (COUCH has 2× training clips from the
  COUCH/SOFA alias merge), TEDDY-BEAR→BEAR, FOOD→EAT, CLEAN→WIPE. Class-balanced loss targets this.
* *Too few examples:* classes with fewer than 20 training clips reached 56 % recall, against 78 % for 25–30 clips.
  Tranche D raised the median to ~37 clips per class.

## 7. Independent validation (holdout-2)

Pre-registered at `vocabulary/holdout-2.json` before any V3.1 training. The cohort is PopSign test round 1
(10 signers, 3,043 clips never extracted or scored before) and ASL Citizen validation-split signers (never
used; evaluation only, aggregate results only). Both models were frozen first (`models/v3.1/FREEZE.json`,
committed in `6a97a24`) and each was evaluated **once**. Lock files are in `ledger/holdout2/`.

**PopSign test round 1:** 2,885 known clips covering 523 / 523 classes, plus 48 never-trained-sign clips.

| Model | Top-1 | Top-5 | Macro recall | Balanced: correct / precision / wrong / FAR | Strict: correct / precision / wrong / FAR |
| --- | ---: | ---: | ---: | --- | --- |
| V3.0 | 81.7 % | 96.6 % | 81.3 % | 62.5 % / 94.1 % / 4.0 % / 18.8 % | 53.0 % / 98.3 % / 0.9 % / 16.7 % |
| **V3.1** | **83.6 %** | **97.1 %** | **83.1 %** | **68.2 % / 95.4 % / 3.3 %** / 29.2 % | 56.9 % / 95.9 % / 2.4 % / 22.9 % |

**ASL Citizen validation signers:** a different recording domain (home webcams). 5 signers, 1,100 known
clips over 300 covered classes, plus 300 out-of-vocabulary clips.

| Model | Top-1 | Top-5 | Balanced: correct / precision / FAR | Strict: correct / precision / FAR |
| --- | ---: | ---: | --- | --- |
| V3.0 | 59.9 % | 78.7 % | 39.4 % / 84.7 % / 11.3 % | 32.2 % / 88.5 % / 5.7 % |
| **V3.1** | **61.9 %** | **80.3 %** | 45.1 % / 86.4 % / 15.0 % | 34.3 % / 90.2 % / 5.3 % |

**Reading:** V3.1 is better at recognising known signs on both independent cohorts. The balanced preset
trades this for a higher false-accept rate: on ASL Citizen, at roughly matched FAR, V3.1 is still 3–5 points
ahead. V3.0's strict preset had the lowest PopSign FAR, but that figure rests on 48 clips. The webcam
domain gap (~84 % → ~62 % top-1) is the largest remaining accuracy problem.

## 8. Full vocabulary coverage

All 523 classes were exercised in real Chrome using one never-used holdout-2 clip per class, transcoded to
480 px and run through the lab's file mode, which shares the same worker and segmentation code as the camera
(`ledger/coverage523-v3.1-chrome.json`).

| | Chrome | Native Python + ONNX |
| --- | ---: | ---: |
| Top-1 correct | 429 / 523 (82.0 %) | 431 / 523 |
| Accepted correct | 346 | — |
| Wrong accepts | 20 | — |
| No sign detected | 3 | — |

Parity Python ↔ Chrome:
* top-1 agreement 96.4 % and decision agreement 94.3 %
* median hand-landmark error 0.00053 (normalised)
* ONNX runtime logit error ~2e-6

Disagreements come from the MediaPipe WASM and Python builds tracking a few frames differently, not from the
model. Every class loads, runs and can be predicted. No class is unreachable.

## 9. New model and provenance

`models/v3.1/`: `model.onnx` (sha256 `b3e05424…`), `meta.json`, both presets, validation reports, configs and
training logs, plus `FREEZE.json` with all fingerprints.
* **Architecture:** ensemble of two Convformers (d=192, depth 2, 1.71 M parameters each). The featurizer is
  inside the ONNX graph. Inputs are hands and pose; face is not used.
* **Training data:** PopSign ASL v2.1 train tranches A+B+D (19,587 clips, official signer-disjoint
  splits) plus 600 FSBoard train windows as UNKNOWN. Both datasets are CC BY 4.0. No ASL Citizen or test data
  was used.
* **Seeds:** standard loss (`v31-s0`, best val 80.0 %) and class-balanced loss 0.5 (`v31-bal`, 80.5 %),
  55 epochs each, trained on the CPU in this container. No paid compute was used.
* **Selection:** PopSign validation signers, calibration-only unknown signs, and development reels from
  validation signers. The V3.0 sealed test was not used for any V3.1 decision.
* **Vocabulary:** unchanged (523 classes, `vocabulary/classes-v3.0.json`).
* **V3.0** is preserved unchanged in `models/v3.0/`, along with its sealed reports.

## 10. Remaining blockers

1. **Real-device performance is unmeasured.** All fps figures come from CPU-only headless Chrome. GPU
   WebGL, laptop webcams and phones still need testing on real hardware.
2. **Webcam domain gap.** ASL Citizen top-1 is ~62 % versus ~84 % on PopSign. More varied training video,
   for example ASL Citizen's train split, which its licence restricts, or consented in-house recordings, is
   the next accuracy lever.
3. **Unknown-sign false accepts.** Balanced FAR is 15–29 % across cohorts. Strict is 5–23 %. The PopSign
   unknown set is small (48 clips). Ordinary non-sign motion (scratching, gesturing while talking) was
   **not measured**, because no licensed footage of it exists here.
4. **Lexical variants.** Pairs such as AWAKE/WAKE are inherently ambiguous in isolated recognition. They need
   context or UI handling, not vocabulary edits.
5. **Unused data.** PopSign tranche E was not used because of CPU time. It is the cheapest further gain.
6. **No human trials.** Every result here uses recorded datasets. Deaf signers have not used the live lab.
7. **Not deployed.** The lab runs locally (`engine-v3/web`). No hosting token was provided, and the production
   app, Firebase and Vercel were not touched.

## 11. Commits and draft PR

Branch `claude/friendly-thompson-qjcse8`, draft PR
[adamjamiesimson/SignRelay#65](https://github.com/adamjamiesimson/SignRelay/pull/65), which stays a draft.
V3.1 commits run from `60a31d2` (CI repair) to the head of the branch. Raw videos, landmark caches and
ASL Citizen per-clip data are not committed: only code, models, aggregate metrics and the ledger. PR #62 and
PR #63 were not touched.

## 12. Reproduction

Requirements and the base pipeline are in [README.md](README.md#reproduce). V3.1-specific steps, with
`D` outside the repository:

```bash
# extraction: tranches A, B, D (train), F-test-r1 and H2-aslc-val (holdout-2); see pipeline/run_extract_v31.sh
cd engine-v3/pipeline && python build_cache.py $D/lm $D/cache3 train val
python build_holdout2.py $D/lm $D/popsign/plan-F-test-r1.json $D/cache3        # h2_popsign + aslc_val
cd ../train
python train.py --cache $D/cache3 --out $D/runs/v31-s0  --kind convformer --epochs 55 --no-face --fs-negatives --seed 0 --balance 0
python train.py --cache $D/cache3 --out $D/runs/v31-bal --kind convformer --epochs 55 --no-face --fs-negatives --seed 0 --balance 0.5
R="$D/runs/v31-s0 $D/runs/v31-bal"
python evaluate.py prototypes --run $R --cache $D/cache3 --no-face --out $D/protos31.npy
python evaluate.py calibrate  --run $R --cache $D/cache3 --no-face --prototypes $D/protos31.npy --max-far 0.20 --out policy-balanced.json
python evaluate.py calibrate  --run $R --cache $D/cache3 --no-face --prototypes $D/protos31.npy --max-far 0.10 --out policy-strict.json
python export_onnx.py --run $R --out ../models/v3.1 --policy policy-balanced.json --cache $D/cache3
python evaluate.py report --run $R --cache $D/cache3 --no-face --split h2_popsign --policy policy-balanced.json \
       --prototypes $D/protos31.npy --sealed-test --freeze-id v3.1 --out h2.json   # refuses a second run
cd ../web && V3_OUT=$D/dist node build.mjs ../models/v3.1 && node serve.mjs $D/dist 8792
cd ../parity
python make_reel.py ...                                   # development or holdout reels (.y4m + truth)
node chrome-camera-replay.mjs http://127.0.0.1:8792 reel.y4m truth.json out.json && python score_reel.py out.json
python camera_diagnostic.py ../models/v3.0 diag.json out.json ...
```

Exact runs, hardware and timings are in `ledger/experiments.jsonl`. Lab URL switches:
* `?delegate=cpu|gpu`
* `?pose=1` (pose every frame)
* `?split=1` (parallel hand/pose workers)
* `?latest=0` (old scheduler)
* `?clf=0` (classify on the tracking worker)
* `?debug` (diagnostics)
