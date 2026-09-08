# Recognition timing repair — 8 September 2026

## Reproduced regression

The preceding movement patch rejected hand observations more than 240 ms apart,
and general movement/personal matching rejected frame intervals above 250 ms.
A continuous 300 ms camera cadence therefore blocked common ASL signs and saved
personal signs. ASL model scheduling also depended on every sixth frame, which
could miss the entire completed-movement window at low capture rates.

Before the repair, nine of the ten initial timing regressions failed. The
long-pause negative case still passed. These are synthetic software regression
cases, not measurements of sign-language accuracy on real people.

## Repair

- Estimate recent frame cadence with a bounded tracking-gap allowance. Preserve
  current-hand, minimum-observation and coverage requirements.
- Start a fresh observation window after a long pause or lost tracking rather
  than rejecting all subsequent movement until the old window expires.
- Schedule eligible ASL inference by elapsed time while retaining the
  two-fresh-prediction confirmation requirement and stale-result invalidation.
- Leave alternate frames for hand tracking on slow devices instead of running
  face and pose inference on every frame.
- Accept continuous personal recordings with at least eight visible samples and
  700 ms of observed duration. Long tracking gaps remain invalid.
- Distinguish camera access, missing/busy camera and tracking-model startup
  failures. Repeated frame-processing failures stop the broken session and
  expose the camera retry control.
- Avoid Array.prototype.findLast in movement segmentation for older browsers.

The existing Firebase project, routes, language adapters, model weights and
confidence thresholds are preserved. Personal recognition is exercised through
the real worker for each of the six language selections; this is not an
accuracy claim for those languages.

## Verification and deployment

The new cases cover 300 ms frame spacing, uneven delivery, fresh movement after
camera/tracking pauses, long-pause negatives, idle negatives, research-model
scheduling and personal recognition in all six language selections.

The Firebase static build passed locally. Lint had zero errors and two existing
image-optimization warnings. The final GitHub Actions build runs the complete
test suite, lint and Firebase export again.

The deployed worker, ASL model metadata, all nine ASL weight parts and ONNX
runtime assets returned HTTP 200 during diagnosis. The remote browser could
open the translator but could not start a camera. A browser check of the local
patch was interrupted when the coding environment became unavailable. A real
phone/tablet camera session and real-sign accuracy remain unverified.

Run npm run build:firebase before deploying: it regenerates the worker from the
updated TypeScript and rebuilds the static out directory. The repository's
checked-in generated worker is not the source of the recognition changes.
Use FIREBASE_HOSTING_UPLOAD_CONCURRENCY=1 for the existing Cloud Shell upload
workaround.
