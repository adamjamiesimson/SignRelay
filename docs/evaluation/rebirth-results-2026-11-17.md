# SignRelay Project Rebirth

**Release recommendation — HOLD.** The local branch preserves the existing translator and implements a separate on-device research path for small-vocabulary ASL. The new scores require signer, live-camera and ordinary-movement validation before they can drive transcript insertion.

## Recovery and baseline

The previous Windows checkout was clean at `26aacadc14ce171f2eaeba4b565175cc9d27eeda`. Its ancestry contains `5433229` and PR #61 at `28a3a3bc9e872ff947f7238556b843a12f3ac25a`. The GitHub review branch still resolved to `28a3a3b`. A write-authentication dry run could not obtain a GitHub credential. Development proceeded in an independent copy on `codex/signrelay-rebirth`.

| Reference | Correct | Wrong | Abstained | Scope |
| --- | ---: | ---: | ---: | --- |
| PR #61 hosted cohort A | 15 | 11 | 53 | 40 target and 39 other-sign phone clips. YES 0/8. |
| PR #61 controlled landmark replay | 8 | 9 | 25 | 42 already exposed recordings. |
| Sprint 2 follow-up on those exact 42 streams | 9 | 5 | 28 | Previously logged; see the paired report. |
| Fresh Windows replay at `26aacad` | 5 | 0 | 6 | Locked 11-clip development pilot. Exact gate passed. |

PR #61’s hosted cohort A and the earlier `588a754` 79-clip report are distinct runs. The earlier branch accepted a wrong word on 14 clips at the nominal 20 source frames/s. PR #61’s exact counter was 11. The 260/684 adversarial result comes from synthetic geometry fixtures and measures that test inventory. [Sprint 2 history](recognition-sprint-2-2026-11-17.md) · [Earlier cadence comparison](recognition-sprint-2026-11-16.md) · [Sprint 2 follow-up](recognition-sprint-2-followup-2026-11-17.md)

## Failure mechanisms

- Camera frames move from the browser’s paced main-thread Gesture Recognizer to a bounded worker queue. Face and pose are refreshed at a lower cadence and carried forward as observed context. The production worker has personal matching, six starter rules, a generic motion gate and the ASL-specific movement gate. Research suggestions take a separate path from confirmed transcript words. The frontend owns transcript editing, persistence, speech and camera lifecycle.
- The 11-clip Windows replay had hands in 152 of 414 analysed source frames. Five clips can be recognized while the tracker still loses much of the movement. Sparse or discontinuous hands mean handshape and motion are often unobservable, even for a correct publisher label.
- The starter rules encode individual motion patterns. The prior audit found HELLO patterns that also matched ordinary waves and near-face movements. A THANK YOU recording had an extrapolated wrist outside the image that completed the PLEASE rule, corrected in `e432200`. Rule tweaks can trade recall for fewer insertions because different movements share the same gross trajectory.
- Pose-TGCN expects OpenPose measurements and training-style isolated windows. The app maps MediaPipe tracks into that format and the two estimators and segmentation protocols differ. The earlier checkpoint comparison reported 9.9% top-1 on its MediaPipe inputs. A closed-set label score provides weak evidence for unsupported signs. Model-only results enter the app as suggestions for confirmation.

## Tracking probe

Eight fixed exposed PopSign recordings were extracted at a nominal 20 source frames/s on the same Intel Core i7-10510U Windows host. Native Gesture Recognizer tracked hands on 154/326 frames and Hand Landmarker did so on 168/326. The median of per-clip median tracking times was 123.0 ms and 152.3 ms, respectively, including face and pose cadence. The timing runs shared the host with other verification work. The coverage gain came mainly from one HELLO clip. This measured observation coverage and latency. Sign correctness and physical handedness require additional evaluation. Gesture Recognizer remains the app default.

Hand Landmarker used Google’s versioned float16 v1 Task bundle with SHA-256 `fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1`. [Google model documentation](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker)

## Application verification

The Windows capture guard now exercises an actual directory junction on Windows and a file symlink on POSIX. The dataset guard names its Python interpreter explicitly when needed. The trial logger uses the platform path rules, and the glob test asserts the shim’s POSIX output. Nested npm commands use npm’s JS entry point. The worker watchdog and latency counters use a monotonic clock. Changing tab visibility clears stale suggestions and recognition feedback when the worker resets.

The ASL static export passed runtime integrity and rendered HTML checks. Headless Chrome passed strict offline operation with zero non-loopback page or worker requests, repeated camera start and pause, hidden-tab recovery, external track termination and fault recovery after model and worker failures. The concurrent fake-camera offline run measured 5.1 analysed frames/s, below the demo’s 10 frames/s target. This is a software test on one host with a synthetic no-hands camera input.

## Matched model comparison

PopSign v1.0 supplied 122 training recordings from 31 signers and 68 validation recordings from four different signers. Validation contained eight examples per target gloss and four examples per unsupported gloss. Four training folds selected score and margin thresholds before scoring validation. The final holdout media stayed sealed. Extraction recovered every listed clip after correcting a sparse gesture-category assumption. Three validation clips had insufficient hand evidence for a descriptor, and were counted in the results.

| Native landmark replay | Correct / 40 | Wrong target | Target abstentions | False accepts / 28 unsupported |
| --- | ---: | ---: | ---: | ---: |
| Existing worker, same native tracks | 18 | 3 | 19 | 6 |
| Temporal centroid, publisher clip boundary | 11 | 0 | 29 | 3 |
| Ridge, publisher clip boundary | 8 | 0 | 32 | 1 |
| Ridge, detected boundary | 9 | 0 | 31 | 0 |
| Motion-window augmented centroid, detected boundary | 11 | 0 | 29 | 2 |
| Motion-window augmented ridge, publisher clip boundary | 21 | 0 | 19 | 1 |
| Motion-window augmented ridge, detected boundary | 19 | 0 | 21 | 1 |

The research candidate is class-balanced ridge regression over observed time-binned landmarks, with an explicit unsupported class and learned score/margin cutoffs. Training adds the first existing gate segment, the longest spotter segment and a short time crop where available, with equal total weight per recording. Longest-proposal selection uses segment length before scoring. The selected stream configuration uses the new bounded motion spotter. The existing motion gate with the augmented model reached the same 19/40 and 1/28 aggregate counts. The model remains a local diagnostic suggestion path.

The selected stream produced 19 correct results among its 20 accepted clips, or 95% precision, and recalled 47.5% of the target clips. Per-gloss correct accepts were HELLO 1/8, THANK YOU 5/8, PLEASE 6/8, YES 3/8 and NO 4/8. It confused one CAT with HELLO. The baseline did particularly well on NO at 7/8, so route-wide replacement would lose coverage. The publisher-bounded version reached 95.5% precision and 52.5% recall. Its clip-level Wilson 95% intervals were 78.2–99.2% and 37.5–67.1%. Dependence between recordings from the same signer makes those intervals optimistic. The four-person development cohort can guide model selection and supplies limited evidence about the wider signing population.

With its fitted unsupported class but no score/margin cutoff, the first ridge model returned 35/40 correct target clips and accepted 8/28 unsupported signs. Its stricter pooled threshold reduced unsupported acceptance to 1/28, with recall falling to 8/40. A class-specific cutoff probe achieved 19/40 and 1/28 with augmented ridge on publisher-bounded inputs, below the pooled result. Recorded proposal-level results preserve correct accepts, errors and abstentions.

The augmented ridge export occupies 74,341 bytes. SHA-256 is `7f8668b48c9d15584159462e5a0287c2510036fdd494429872382b1a8ad9ed73`. The JS scorer matched Python on 65 scored clips within 1.9 × 10⁻¹⁵. Float32 parameter rounding changed zero validation decisions. Node feature extraction and classification measured median 0.68 ms and 0.25 ms, respectively, during concurrent development work. The spotter’s accepted outputs occurred a median 1.75 s from the first analysed source frame. That offset includes preparation and signing time. A sign-end latency measurement requires boundary annotations.

An image-feature comparison used the same clips, signer folds and ridge objective with gradients from tracked hand crops. Image features alone accepted 7/40 correct targets and 1/28 unsupported signs. Combining image gradients and landmarks accepted 22/40 targets and 2/28 unsupported signs with publisher boundaries. The hybrid remains an offline candidate. The augmented landmark model had one fewer unsupported false accept and completed browser and streaming checks. Both selected landmark weight files reproduced byte-for-byte from the augmentation commit `a332f7f900a13295ff521bb847e57b0b5824a106`.

## Browser replay and cadence

Chrome 157 on Windows replayed one publisher clip for each of the five target and seven unsupported glosses, drawn from the same four-signer validation cohort. The two browser passes analysed the same 493 source frames, with hands on 157. Source-frame delivery was 20.1–20.6 frames per source second. All twelve clips completed in each pass. The production worker confirmed HELLO and THANK YOU and produced HELLO on FISH. Both ridge models proposed PLEASE and THANK YOU and rejected all seven unsupported clips. The lab’s coverage and proposal paths use separate output counters. The browser proposals never reached the transcript.

In a separate camera-path experiment, prerecorded PLEASE and FISH clips passed through the actual web app, Chrome’s file-backed test camera and the regular recognition worker. PLEASE abstained, with two hand-tracked frames out of 61 forwarded. FISH produced no word, with four hand-tracked frames out of 64. Throughput was 3.3 and 3.5 forwarded frames per second during concurrent work. Startup measured 5.0 s and 4.7 s. Auto-speak emitted no utterance in either run. Both sessions released the camera on pause.

A repeat PLEASE replay through the full build improved to 6.4 forwarded frames/s and 2.9 s startup. SignRelay observed hands on three of 116 forwarded frames and again abstained.

| Native cadence probe | Correct / 5 | Wrong target | Target abstentions | False accepts / 3 unsupported |
| --- | ---: | ---: | ---: | ---: |
| 10 sampled source frames/s | 0 | 0 | 5 | 0 |
| 15 sampled source frames/s | 1 | 1 | 3 | 1 |
| 20 sampled source frames/s | 1 | 0 | 4 | 1 |
| 30 sampled source frames/s | 1 | 1 | 3 | 1 |

The cadence probe used the same eight exposed recordings and the bundled worker. The 15 and 30 fps runs confused THANK YOU with PLEASE and all three higher cadences confused HORSE with NO. These results and the earlier larger trial support retaining the current nominal cadence while investigating the gap between source-step throughput and live analysis.

## Final software checks

- Typecheck, lint, worker bundle, repository asset guard and secret audit passed. A synthetic secret marker removed from a fixture checkout was detected at the original line in history. The dependency policy and production npm audit reported zero advisories.
- The full Vitest suite passed 927 tests with two test workers and a 30-second per-test timeout after a concurrent default-timeout run exposed contention. The pre-existing opt-in experiment case ran separately and passed. The synthetic baseline produced a wrong word in 260 of 684 adversarial runs.
- Both ASL and full Firebase exports passed integrity verification. Full-export rendered HTML and workspace Chrome checks passed, including language and transcript isolation, storage failure, camera permissions, duplicate handling and confirmed-only announcements.
- The Chrome source-timestamp control passed after installing its FFmpeg fixture generator. The forced browser failure control preserved a partial NO result and classified the trial as an error. The synthetic-camera lifecycle and fault-injection checks passed.
- The 700 ms synthetic software rehearsal confirmed all six words in order, recorded one speech request per word and recovered after camera interruption. The rapid 250 ms transcript accessibility smoke missed THANK YOU in both runs and stopped at its first assertion. Its remaining in-browser keyboard, touch-target and edit assertions were not reached on this host.

## Release gates

Physical webcam trials with fluent ASL signers, ordinary non-sign motion, sign boundaries, real iOS and Android devices, and an independent final evaluation remain open. The corpus supplies unsupported ASL signs, so ordinary-movement false words per minute are unmeasured. Device throughput and memory require a camera trial on representative hardware. SORRY requires reviewed, authorized examples. The sample never evaluates continuous signing or sentence translation.

See [data rights and suitability](rebirth-data-sources.md) and the [reproduction commands](rebirth-reproduction.md).
