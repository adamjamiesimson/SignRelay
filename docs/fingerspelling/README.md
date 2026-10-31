> **Follow-up: real inference now exists as an experimental sequence pilot.** See [measured recognition, provenance, browser parity and reproduction commands](SEQUENCE-PILOT.md). The report below is the historical interface-only sprint, not the current recognition coverage.

# ASL fingerspelling sprint — blocked recognition, isolated text workspace

**Release recommendation: NO-GO. No ASL alphabet classifier is installed or enabled.**
This change is independently useful engineering groundwork, not a functioning webcam fingerspelling recognizer.
The final objective remains incomplete. Manually typing HELLO is not recognition evidence.

## Integration and dependency review

The feature branch is based on #47 at `fa97370706cd2d878931c8c534cb3244ff605e33`;
the draft PR targets `codex/stabilisation-2026-10-31`, not main.
Review the feature diff separately. Do not merge the inherited research stack on this PR's strength.

- #43 decouples tracking and preserves trajectories.
- #44 integrates #43 into a candidate with lifecycle, model and runtime checks.
- #45 preserves recognition decisions while optimizing inference/matching.
- #46 adds tracking-interruption invalidation, cooperative inference scheduling and RSL disposal.
- #47 sits on a later research parent, retains the download trust failure, validates extracted artifacts before training, and restores original logo colours.
- These dependencies have their own unresolved release blockers. In particular #47's security audit and verified source acquisition failures are not fixed by this feature.

The existing LiveVision camera, worker tracking, mirrored overlay, word-model loader,
RecognitionSession bounded queue, personal-sign normalization/storage, languages,
tutorial, transcript and Firebase configuration are unchanged.
The only frame-routing change is to withhold frames from the word recognizer in spelling mode.
Switching modes synchronously resets word recognition and blocks queued callbacks;
effect cleanup terminates the old worker. Returning creates a fresh worker without
clearing word transcript state. Camera capture and hand overlays keep running.
There is no new alphabet inference lane or processing backlog while the model is unavailable.

## Actually implemented

- ASL-only Word Recognition / Fingerspelling selector; words remain the default.
- Editable, bounded in-memory spelling draft preserved across mode switches.
- Backspace (Unicode code point), Space, Clear, explicit Speak and Stop.
- Existing speech locale, volume and rate are reused; letters never trigger speech.
- Clear local data also clears the spelling draft. Drafts are not persisted after reload.
- Honest unavailable state, disabled Confirm letter, compact alphabet/first-use notes.
- Existing dark/green tokens and responsive layout; no logo or brand asset modifications.
- A pure deliberate-commit controller, tested with synthetic classifier evidence.
  It requires a score, sample count, elapsed dwell, fresh timestamps and consistent hand identity.
  Blank/uncertain input, transitions, resets, long gaps and handedness changes discard evidence.
  Each commit consumes its evidence; fresh evidence plus another deliberate action allows repeated letters.
  J/Z require a temporal classifier's completed-motion signal.
  **This controller is not a classifier. It is not wired into the UI because there is no verified model.**
  Its test policy is arbitrary test input, not measured calibration.
- Alphabet-index mapping tests explicitly distinguish labels from recognition coverage.

## Model/data investigation and precise blocker

| Source | Finding | Decision |
| --- | --- | --- |
| Shipped WLASL2000 | Some single-letter labels exist alongside word classes; OpenPose word checkpoint with a MediaPipe adapter, no complete alphabet evaluation | Do not filter word logits into an alphabet recognizer |
| Shipped ASL100 | Word labels, no alphabet | Unsuitable |
| Shipped RSL | Russian alphabet, not ASL | Never reuse for ASL |
| [FSboard primary paper](https://arxiv.org/html/2407.15806v1) / [publisher dataset](https://www.kaggle.com/datasets/googleai/fsboard) | Relevant real sequence data; publisher states CC BY 4.0. Paper's baseline uses MediaPipe Holistic with a 300M-parameter ByT5 model | Best identified data candidate; not a verified lightweight browser artifact |
| [ChicagoFSWild publisher](https://home.ttic.edu/~klivescu/ChicagoFSWild.htm) | Real fingerspelling sequences and signer partitions; inspected page does not establish a compatible redistribution licence | Rights need verification before ingestion; no download/import performed |
| [signspell upstream](https://github.com/TheMadrasTechie/American_sign_language_sign_recognition) | MIT repo advertises 30-frame, right-hand LSTM alphabet model; inspected README lacks a signer-independent evaluation and sufficient training-data provenance for this integration | Do not copy weights or infer coverage from the README |
| Static image alphabet models | Single frames cannot establish movement recognition for J/Z or natural transitions | Not an A–Z sequence solution |

The blocker is **not that licensed fingerspelling data does not exist**. It is the absence,
in this sprint, of a provenance-verified, checksummed, lightweight compatible checkpoint
and validated end-to-end input/output contract. No new dataset, model, training result,
accuracy number or certificate exception was fabricated. No webcam or personal signing
data was uploaded. TLS and all existing security gates remain unchanged.

Before enabling recognition:

1. Freeze publisher version, licence/attribution, file sizes and SHA-256 hashes.
2. Obtain a suitable lightweight static+temporal or sequence model; reproduce exporter parity.
3. Define and verify its exact landmark order, camera coordinates, handedness,
   mirroring and normalization. Preserve palm orientation distinctions (e.g. G/Q, K/P);
   do not choose a generic rotation normalizer before knowing the training contract.
4. Load verified assets off the UI thread using the existing model-integrity patterns.
   Use one in-flight inference plus at most one replaceable latest frame, cancellation
   epochs, a watchdog and timestamp expiry. None of this is claimed as an implemented
   alphabet runtime in the blocked build.
5. Calibrate abstention and deliberate-commit policy on held-out signers and no-sign/OOV data.
6. Use real sequence evidence for J/Z; a completed-motion boolean in a unit fixture is not
   movement recognition. Evaluate left/right signers and distinguish shape confusions.
7. Wire candidates/commits to the existing workspace only after the above gates pass.

## Coverage and real recognition evaluation

See [per-letter status](coverage.json). **A–Z: unsupported, 0 evaluated examples each.**
No per-letter accuracy, false-positive rate or letter latency can be reported.
No physical webcam, phone or consenting signer session was accessed.
Particularly pending: A/E/S/T/M/N, U/V/R, G/Q, K/P, I/J and all J/Z trajectories.

Required evaluation: signer-disjoint data, both hands, mirrored/unmirrored input, device
and lighting variation, no-hand/no-sign/OOV/transition sequences, repeated letters and
names outside a dictionary. Retain per-letter counts, confusion matrix, abstentions,
false accepts per minute and word/character error rates. Split development/calibration
from sealed evaluation and do not tune on the holdout.

## Verification and performance

All execution is on authorized GitHub-hosted runners, never the user's physical device.

- `npm test -- tests/fingerspelling.test.ts`: software unit tests.
- `node tests/fingerspelling-browser-smoke.mjs <chrome>`: rehearsal export, fake camera,
  synthetic WORD fixtures, real UI/camera lifecycle, text/speech, isolation, offline editing,
  desktop/mobile and screenshots. No fake alphabet recognizer is injected.
- `scripts/benchmarks/fingerspelling.ts`: 100,000 synthetic controller events on Node.
  Records median/p95 controller processing only. Classification, real confirmation and
  capture-to-overlay timings are null, not zero.
- Existing `?perf` readout still measures capture, hand tracking, overlay age and word
  classification separately. New device measurements, extended CPU/heap/thermal runs,
  slow-device behavior, real camera recovery and assistive-technology review are pending.

The isolated workflow uploads browser JSON, desktop/mobile screenshots and the synthetic
benchmark as `fingerspelling-software-evidence`, tied to its exact workflow commit.
Core CI, audits and existing workflows remain intact. A focused workflow passing is not
a substitute for security/release gates. See the draft PR for actual run outcomes.

## Preview / release

No merge into main and no Firebase deployment. A Vercel preview may be supplied only if
the connected project allows it; preview readiness does not establish recognition quality.
Keep this change draft. **NO-GO for alphabet-recognition release or integration into main.**
