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
| Class-balanced loss (weights ∝ (median/count)^0.5) | Controlled pair of runs, § 6 | V3_1_PENDING |
| More training data (tranche D: +5,711 clips; ~37 clips/class) | § 6 | V3_1_PENDING |

## 4. Browser replay before and after

V3_1_PENDING

## 5. Analysed FPS and latency

V3_1_PENDING

## 6. Accuracy, unknown-sign rejection and error types

V3_1_PENDING

**Error types (V3.0, validation):**
* *Mutual near-identical or variant signs:* AWAKE↔WAKE, DEER↔MOOSE, WERE↔WAS, GENTLE↔SOFT, CAN↔COULD,
  GIFT↔PRESENT, BROKEN↔BREAK. These are label-variant ambiguity, not model failure. The vocabulary stays frozen.
* *One-way absorption, partly a class-prior effect:* BENCH→COUCH (COUCH has 2× training clips from the
  COUCH/SOFA alias merge), TEDDY-BEAR→BEAR, FOOD→EAT, CLEAN→WIPE.
* *Too few examples:* classes with fewer than 20 training clips reached 56 % recall, against 78 % for 25–30 clips.

## 7. Independent validation (holdout-2)

Pre-registered at `vocabulary/holdout-2.json` before any V3.1 training: PopSign test round 1 (3,043 clips
never extracted or scored before) and ASL Citizen validation-split signers (never used; evaluation only).

V3_1_PENDING

## 8–12

V3_1_PENDING
