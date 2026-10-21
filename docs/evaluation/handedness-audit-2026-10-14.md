# ASL/BSL handedness audit — 14 October 2026

**Status:** input-slot contract tested; live-camera handedness labeling remains unverified. No label swap or model-weight change has been made.

## Evidence from code

- VisionEngine.process() feeds the camera video directly to GestureRecognizer.recognizeForVideo() without an image-flip step. Mirroring the screen preview through CSS does not alter the inference input.
- Handedness from MediaPipe Tasks is passed into each VisionFrame unchanged.
- ASL and BSL adapters build signer-left then signer-right hand OpenPose nodes and trust those input labels.
- Regression tests on this branch assert the tensor slots into which labeled left/right hands are placed.

## Why a blind swap is unsafe

Legacy MediaPipe Hands docs say handedness assumes a selfie-mirrored input:
https://github.com/google-ai-edge/mediapipe/blob/master/docs/solutions/hands.md

An October 2026 issue reports the *new Tasks API* corrected that legacy mapping in v0.10.5 and refers to the signer's real hands with unmirrored input:
https://github.com/google-ai-edge/mediapipe/issues/6376

SignRelay uses @mediapipe/tasks-vision@0.10.22-rc.20250304. This analysis does not replace a physical test on that exact package. Therefore neither the legacy rule nor the reported fix is sufficient evidence to change the app.

## Required physical test

1. Use a real camera, and note the signer's **real subject hand** (not screen-left or screen-right).
2. On a development-only test setup, display just the handedness label and approximate wrist side while raising the right hand alone, then the left hand alone. Do not save identifying images or raw landmarks.
3. Repeat with a second device, including any video feed that is pre-mirrored.
4. Compare unchanged and swapped input mappings on fresh, signer-confirmed and consented ASL/BSL videos, measuring correct matches, wrong accepted signs and abstentions.
5. Only change a camera orientation adapter if the data demonstrates reversal. Do not blindly swap the model's OpenPose slot order.

## Decision

Leave handedness unchanged. Synthetic slot tests verify model-adapter wiring only, not camera handedness or real-world signing accuracy.

## 21 October 2026: single-hand label continuity, tried and reverted

**Hypothesis.** The ASL rules and the motion segmenter group samples by MediaPipe's per-frame handedness label. A sustained label change on one moving hand could split it into two partial tracks. In synthetic tests, a mid-sign switch made YES, PLEASE and SORRY abstain; single-frame flicker up to every third frame was already tolerated.

**Change tried.** For the ASL rules and segmentation only, a single hand that stayed spatially continuous for 300 ms inherited its established label. The models kept the raw labels.

**Real-video result.** In the paired CI pilot (run 39556336628), the candidate lost the correct HELLO on `hello-gtsignstudy4a.8033`. That clip's 9 tracked frames are 8 "Right" and 1 "Left". Relabelling the single Left frame into the Right track changed the window enough to fail the HELLO rule. No clip gained a correct word.

**Decision.** Reverted. One measured real-video regression and no measured benefit outweigh the synthetic fragility. Retuning the rule until this clip passes would be fitting to the same reused development clips. `tracker_behavior.single_hand_label_sustained_switches` in opt-in traces stays available, so future reviewed recordings can show whether sustained switches actually occur.
