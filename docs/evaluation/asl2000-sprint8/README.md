# Sprint 8 — Why the 2,000-class ASL model failed, and what fixes it

Date: 30 October 2026. Base: PR #46 head `6eb9c64`.

## Summary

- **The primary failure was in SignRelay, not in the model.** MediaPipe Tasks reports `visibility: 0` for every hand landmark, because the hand model has no visibility output. The ASL-2000 adapter treated `visibility === 0` as "not detected", so **all 42 hand nodes were erased on every frame the app has ever sent**. The model only ever saw 13 body joints. On the publisher's own keypoints, the shipped path scored **0.0% top-1, about the same as chance**. The official protocol scores **22.4%**. On WLASL test videos run through MediaPipe it scored **0.7%**, and all 29 of its gate-accepted words were wrong. Synthetic test fixtures never set `visibility`, so every unit test passed.
- **The checkpoint itself is weak, and its confidence is not usable as a reliability signal.** Even on the publisher's own inputs it reaches only 22.4% top-1 and 52% top-5 over 2,000 classes (it matches the published 23.65%). Only about 36% of the predictions it accepts at the production gate are correct, and that precision stays at 35–37% at every threshold up to 0.95.
- **There is a large MediaPipe-to-OpenPose domain gap.** On the same test videos, the fixed adapter reaches 7–10% top-1 from MediaPipe landmarks against 22% from the publisher's OpenPose keypoints. Accepted-word precision is 13%.
- Fixes implemented (evidence below): hand landmarks reach the model; the publisher's 25 fps time base with a single 50-frame window from movement onset replaces whole-segment stretching; hands are assigned by nearest pose wrist; body framing is mapped onto training-split medians; and an evidence guard means a window with no observed hand is never classified. Threshold changes were evaluated and rejected.
- **Validated signs: see "Working vocabulary" below.** Installed labels and recognised signs are now shown separately in the app.
- The realistic route to hundreds of reliable signs is a new model trained on SignRelay's own MediaPipe representation from licensed multi-signer data. A first candidate is trained on PopSign ASL v1.0 (CC BY 4.0) with a rejection class and evaluated on unseen signers (see "Replacement candidate").

## How the evidence was produced

Everything ran in GitHub Actions (`.github/workflows/asl2000-diagnostics.yml`), where the publisher data is reachable. Raw videos, keypoints and landmarks never leave the runner; the derived reports are committed under `runs/<run id>/`.

- **Frozen sample** (`frozen-sample.json`): selected from the publisher's `WLASL_v0.3.json` by fixed rules and seed before any result was seen. It has three groups: every official test instance of the 30 everyday signs in the brief (74 instances), 25 random glosses from each WLASL frequency tier (179 instances), and 300 uniformly sampled test instances. That gives 526 unique instances across about 400 glosses. The six starter signs are excluded from the non-starter groups.
- **Isolated evaluator** (`scripts/asl2000-eval/`, `training/asl2000_conditions.py`, `training/tgcn_packed.py`). It bypasses the camera, the motion gate and the confirmation UI, but leaves production rules untouched. Production TypeScript builds every tensor, and a guard checks that the "v1" options are bit-identical to the shipped `prepareTgcnInput`. A NumPy replica of the shipped int8 model scores them; it matches the shipped JS runtime to 1.6e-5 in logits with 100% top-1 agreement over 32 windows.
- **Condition A**: the publisher's OpenPose keypoints. These go through the official float32 checkpoint with the official 4×50 `k_copies` protocol, through the shipped int8 model, and through SignRelay's adapter variants. For the adapter, the keypoints are converted into MediaPipe-shaped frames; hand points carry `visibility: 0`, exactly as Tasks emits them.
- **Condition B**: the same WLASL test videos where the publisher lists a direct (non-YouTube) source. These go through MediaPipe Tasks (the browser's `.task` models and thresholds), frame-aligned to the publisher's keypoints.
- **Condition C**: those clips plus PopSign clips replayed through the production `VisionEngine` and recognition worker in Chrome. Both the shipped (v1) worker and the candidate worker run on identical frames, and the complete live sequences are scored with the isolated evaluator.
- **Condition P**: PopSign ASL v1.0 test-split clips (CC BY 4.0). These come from other signers recording on phones, and include signs that are **not** in the model's vocabulary, used as a rejection control.

## Root cause, hypothesis by hypothesis

| # | Hypothesis | Verdict | Evidence |
|---|---|---|---|
| 1 | Wrong MediaPipe→OpenPose mapping | **Not the cause** (mapping correct) | Labels: the shipped label order equals the publisher's `LabelEncoder` order (sorted lowercase glosses), checked against `WLASL_v0.3.json`. Joints: publisher keypoints routed through SignRelay's adapter score 22.4% top-1, the same as the official protocol's 22.4%. Approximating neck and mid-hip from shoulders and hips costs nothing measurable. |
| 2 | Left/right order, mirroring, scale, normalisation | **Contributes** | Frames are not mirrored (CSS-only preview mirror). MediaPipe labels match the publisher's left/right slots on 89% of two-hand frames; the nearest-pose-wrist rule matches 96%. Swapping the hands collapses accuracy to 0.6%, and the wrist rule recovers 17.3% even with swapped labels. Coordinates: the publisher's coordinates fit a 256-wide frame (0.26% of points fall outside 256 px). MediaPipe positions differ from the publisher's by a median 0.17 model units (about 8% of frame width; shoulders 0.10, elbows 0.23). Mapping body framing to training medians raised B from 8.0% to 9.9% top-1. |
| 3 | Training data vs live inputs differ | **Major contributor** | Same videos: 22% top-1 from OpenPose against 7–10% from MediaPipe (B). MediaPipe finds a hand in 61% of frames; OpenPose finds the right hand in 88% and the left in 71%. |
| 4 | Temporal sampling / incomplete segments | **Contributes** | The publisher trains on 50 *consecutive* frames at 25 fps and pads short clips with the last frame. SignRelay stretched the whole segment, including the settled tail, to 50 samples. On publisher keypoints, stretching costs 4.2 points (18.2% vs 22.4%); at live cadence it costs 3.4 points (17.9% vs 21.3%). |
| 5 | Missing hand landmarks / movement | **Primary cause** | The `visibility: 0` defect above erased every hand: 0.0% top-1 against 22.4%. This was confirmed in the pinned browser runtime on Google's own MediaPipe test images, where every hand point had visibility 0 and every hand node became -1. |
| 6 | Slow inference, prediction expiry | **Not a cause of misrecognition** | 434–478 ms per inference in Node (439 ms median). The worker keeps a completed movement available for 2.5 s, and inference completed on every clip that reached the motion gate (C). An ONNX Runtime Web export of the same int8 weights runs in **18 ms** (WASM, one thread), with 1.7e-5 logit parity. |
| 7 | The model predicts wrongly | **Yes, inherently** | 22.4% top-1 and 52% top-5 on publisher inputs. Accepted-word precision is 36%, and 13% on MediaPipe input. Precision does not improve with a stricter threshold, so confidence carries little information. An all-missing input is classified as WOLF at 0.93 confidence. |
| 8 | The decoder rejects correct predictions | **Minor** | At the production gate on publisher inputs, 41 of 118 correct top-1 predictions were rejected. Lowering the gate admits more wrong words than right ones (see calibration below). The decoder's two-in-a-row rule is analysed in C. |

## Condition A — publisher keypoints (526 test instances)

Run `41064295875`, `runs/41064295875/condition-a.json`. Chance is 0.05% top-1.

| Input → model | top-1 | top-5 | top-10 | median rank | gate accepted | of which correct |
|---|---|---|---|---|---|---|
| Official float32 checkpoint, publisher 4×50 protocol | 22.4% | 52.1% | 63.5% | 5 | 214 | 77 (36%) |
| Shipped int8 model, same tensors | 22.2% | 52.1% | 63.5% | 5 | 208 | 76 (37%) |
| Shipped int8, one centred window | 21.5% | 53.2% | 62.7% | 5 | 221 | 74 |
| Same, hands erased | 0.2% | 0.9% | 1.7% | 972 | 56 | 0 |
| **SignRelay v1 (shipped adapter)** | **0.0%** | 0.9% | 1.1% | 955 | 46 | **0** |
| SignRelay v1 at live tracking cadence | 0.2% | 0.8% | 0.9% | 931 | 49 | 0 |
| Hands kept, whole-segment stretch | 18.2% | 45.4% | 57.4% | 7 | 210 | 64 |
| Hands kept, publisher 25 fps, 4 windows | 22.4% | 51.5% | 63.7% | 5 | 205 | 76 |
| Hands kept, publisher 25 fps, 1 window | 21.7% | 53.6% | 62.9% | 5 | 223 | 76 |
| Live cadence (hands 20 Hz, pose ≤6.7 Hz held), stretch | 17.9% | 44.3% | 53.0% | 8 | 206 | 61 |
| Live cadence, publisher 25 fps, 4 windows | 21.3% | 50.9% | 62.4% | 5 | 205 | 71 |
| Hand labels swapped, label slots | 0.6% | 0.6% | 0.6% | 966 | 129 | 1 |
| Hand labels swapped, nearest-pose-wrist slots | 17.3% | 38.4% | 49.0% | 11 | 175 | 58 |

Parity, shipped int8 vs original float32 on identical inputs: 93.75% top-1 agreement over 32 windows, 97% top-5 overlap and a 0.77 maximum logit difference. Over the full sample, quantisation costs 0.2 points.

### Everyday vocabulary (publisher keypoints; correct / test clips)

Official protocol: BOOK 3/4, DRINK 2/4, GO 2/3, GOOD 2/2, SAD 2/2, DOCTOR 1/3, FAMILY 1/2, FATHER 1/2, FRIEND 1/2, HAPPY 1/2, HELP 1/3, UNDERSTAND 1/2, WALK 1/3, WATER 1/2. The model gets **0** right for BAD, COLD, COME, COMPUTER, EAT, HOT, MOTHER, NEED, SCHOOL, WANT, WHAT, WHEN, WHERE, WHO, WHY and WORK, even with perfect input. **The shipped v1 adapter got 0 of all 74.**

## Condition B — the same test videos through MediaPipe (151 clips)

The publisher listed direct, non-YouTube sources for 357 sampled instances. 151 downloaded and decoded; 161 sources failed and 28 returned non-video. Every one of the 151 aligned with the publisher's keypoint frames, 53 by identity and 98 by time.

| Adapter | top-1 | top-5 | top-10 | median rank | gate accepted (correct) |
|---|---|---|---|---|---|
| **SignRelay v1 (shipped)** | **0.7%** | 0.7% | 0.7% | 924 | 29 (**0**) |
| Hands kept, stretch | 5.3% | 15.9% | 19.9% | 118 | 32 (1) |
| Hands kept, publisher 25 fps, 1 window | 6.6% | 19.9% | 27.2% | 92 | 40 (7) |
| + nearest-pose-wrist hands (4 windows) | 8.0% | 21.8% | 27.2% | 89 | 27 (3) |
| + gap fill + training framing (4 windows) | 9.9% | 24.5% | 31.8% | 68 | 31 (4) |

## Gate calibration

The production gate is confidence ≥ 0.62 and margin ≥ 0.22.

On publisher keypoints with the official protocol, precision stays between 26% and 37% across every confidence threshold from 0.30 to 0.95, while recall falls from 20% to 4%. On MediaPipe input (B) precision is 12–25% at every threshold. **No threshold makes this checkpoint reliable**, so the production gate is unchanged. Lowering it would accept more wrong words than correct ones.

## Fixes implemented

`lib/tgcn-input.ts` and `ASL2000_INPUT` in `lib/asl1000-runtime.ts`:

1. Hand landmarks are no longer erased (`handVisibility: "ignore"`).
2. A publisher-rate time base: frames are placed on a 25 fps grid by their real timestamps, and one 50-frame window starts at the movement onset, padded with the last frame like the publisher's training windows. This fixes the stretch and drops the settled tail that only exists live; it is independent of camera frame rate.
3. Hands go into the nearest-pose-wrist slot, which is OpenPose's own mechanism. The tracker label is used only when the pose cannot decide.
4. Body framing is mapped onto medians of 300 publisher *train-split* clips: neck position, shoulder width and eye height.
5. Evidence guard: no classification unless at least six distinct frames contain an observed hand.

The production confidence/margin gate and the decoder's two-consecutive rule are unchanged.

Regression tests: `tests/asl2000-input.test.ts` covers Tasks-shaped hands, bit-identity of the v1 options, publisher `k_copies` golden values, the fixed-rate grid at 15 and 30 fps, and wrist assignment. `tests/asl2000-evidence-guard.test.ts` covers the all-missing WOLF output and a handless movement never being classified.
