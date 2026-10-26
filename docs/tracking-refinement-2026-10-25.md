# SignRelay tracking and dynamic-sign refinement — 25 October 2026

Implemented locally against `e63fffe64e6cc7136cf5191bd3beb07058c24200`. No Firebase deployment was performed. The existing interface, language registry, vocabulary, transcript, speech, personal-sign storage, and separate Russian/Bangla capture flows are preserved.

**What caused the delay**

The camera loop called synchronous MediaPipe hand, face, and pose inference on the UI thread. The overlay was drawn only after all scheduled inference completed. Face/pose ran on alternate hand frames with a 150 ms minimum interval; this was additional blocking work, not a one-second smoothing filter. CPU inference was forced. This explains measurable main-thread stalls and unnecessary hand-overlay waiting. The reported one-second webcam trail could not be reproduced directly because no live signing session or signer recordings were available.

There was already a bounded recognition-worker queue and a separate template-matching worker. Inspection did not find an unbounded recognition FIFO, repeated per-frame model loading, or overlapping synchronous landmark calls. Model sessions and compiled template features were already cached. These were retained rather than blamed for a nonexistent backlog.

**Implemented changes**

- Added a dedicated tracking worker with one occupied capture/inference slot. Busy input is discarded before allocating a bitmap; the next free animation tick captures the current video frame. Bitmaps are transferred and closed. Stopped sessions, hidden/resumed tabs, and old worker errors cannot publish stale output into the current session.
- Publish hand landmarks before auxiliary face/pose inference finishes, so the main thread can draw them immediately. Sign classification and reference scans remain separate. Canvas dimensions, object-fit behavior, anatomical handedness, and CSS preview mirroring remain aligned with the existing video.
- Try GPU inference, probe its first inference, and automatically recover with a CPU worker if startup/warmup fails. Unsupported worker/bitmap platforms retain a main-thread compatibility fallback. Runtime failures restart tracking with CPU; failed GPU contexts are not reused. Model instances persist across frames.
- Remove the artificial 50 ms capture ceiling in favor of a 33 ms minimum interval, without overlapping inference. Retain existing model smoothing and auxiliary cadence; avoid extra landmark smoothing or recognition debounce on the overlay. Skip detection-state React updates when visibility flags have not changed.
- Add opt-in `?perf` timings for capture, hand inference, auxiliary inference, worker transport, overlay drawing, frame age, recognition processing/communication, neural inference, personal matching, and reference matching. Timing payloads are opt-in so ordinary recognition messages remain deterministic.
- Replace the recognition history's fixed 80/120-frame limit with a 4.5-second, maximum-300-observation buffer. This preserves the existing longest 4.2-second personal-sign window across 10–60 fps and clears history on a backwards clock.
- Resample personal/DTW observations by elapsed time instead of array index. Uneven frame delivery no longer changes which part of a movement appears at the sequence midpoint. Missing observations are not interpolated into invented landmarks. Existing DTW speed handling and distance/margin gates remain.
- New personal recordings use versioned `trajectory-v3` normalization. Observed shoulder references preserve body-relative position; a nearby observed reference spans pose dropout. If the entire body track is absent, a fixed initial wrist anchor preserves travel instead of subtracting a different wrist every frame. Local 3D hand shape/orientation and left/right presence masks remain. Absolute body position is unknown when the body is never visible. Old 208/240-feature examples remain readable and use their legacy normalization; already-lost motion cannot be reconstructed from saved feature rows.

**Measured latency**

Windows x64, Intel Core i7-10510U, Chrome 155.0.8059.86. The paired benchmark used the original engine from the base commit and the candidate on the same generated 1280×720 no-hand canvas sequence: five warmup frames and 20 measured frames per mode. It runs real pinned MediaPipe inference. It does not measure camera exposure/driver buffering, actual screen presentation, hand-track accuracy, or sensor-to-photon latency. Values below are milliseconds, median / p95.

| Stage | Original main-thread CPU | Candidate default, CPU-worker fallback |
|---|---:|---:|
| Bitmap capture | n/a: direct video/canvas input | 0.2 / 0.3 |
| Hand inference | 82.1 / 147.1 | 74.0 / 150.7 |
| Face + pose, per processed frame, including skipped frames | 43.0 / 84.6 | 50.5 / 108.8 |
| Tracking-worker transport residual | n/a | 0.4 / 1.3 |
| Overlay drawing, no hands | 0.0 / 0.1 | 0.0 / 0.1 |
| Capture start → overlay draw | **121.3 / 231.8** | **74.4 / 151.2** |
| Full tracking operation | 121.3 / 231.8 | 118.8 / 193.3 |
| Animation-frame interval | 16.7 / 116.7 | **16.7 / 16.8** |
| Recognition analysis, empty-hand frame | 0.1 / 0.2 | 0.1 / 0.2 |
| Recognition communication residual | 0.8 / 1.0 | 0.0 / 1.9 |

The separately forced CPU-worker run measured 96.1 / 151.1 ms capture-to-draw. GPU context creation succeeded but its warmup inference stalled on this browser; the automatic CPU-worker fallback worked. A working GPU inference path is therefore not verified on this machine.

These are small samples and CPU load matters: an earlier paired run during heavier machine load measured 284/338 ms before and 174/231 ms after. The unloaded result approaches the 100–150 ms goal, but does not establish that target for webcam signing. The UI can now keep painting while inference runs; completed landmark updates can still have a low frame rate. There is no queued-video backlog in the new lane. Time between landmark updates and actual presentation delay remain separate from capture-to-draw age.

Separate browser phase timings used real cached model/reference assets and the existing kinematic SORRY fixture, with one warmup and five measured samples. Downloads are excluded; cooperative yields are included. These are isolated computation timings, not production worker end-to-end measurements or sign accuracy:

| Computation | Median | Largest of five samples |
|---|---:|---:|
| ASL-2000 neural inference | 1,275 ms | 1,914 ms |
| Six personal examples | 16 ms | 33 ms |
| Full 775-reference PSL scan | 559 ms | 727 ms |

The neural model and large reference scan remain material limits on decision time. Keeping them separate prevents their completion time from delaying the hand overlay; their weights and acceptance thresholds were not changed.

**Dynamic-sign evidence and language limits**

The ASL starter recognizer already evaluates movement sequences, with multiple time windows, body-relative mouth/chest position, direction, circle closure/area, ambiguity rejection, temporal consistency, and repeat suppression. These safeguards were preserved; thresholds were not lowered. Its THANK YOU outward mouth stroke and SORRY chest rotation were checked against ASL-specific teaching references: [ASL University THANK YOU](https://www.lifeprint.com/asl101/pages-signs/t/thankyou.htm) and [ASL University SORRY](https://www.lifeprint.com/asl101/pages-signs/s/sorry.htm). Those references are not substitutes for recordings of the user's signing.

| Language/runtime | Target coverage in shipped labels and remaining limitation |
|---|---|
| ASL | Both THANK YOU and SORRY exist; temporal starter rules and the 2,000-class model are used. Existing development aggregates include abstentions and are not evidence for this new worker. |
| BSL | SORRY is a model class; no THANK YOU/THANKS class was found. [BSL SignBank's SORRY entry](https://bslsignbank.ucl.ac.uk/dictionary/words/sorry-1.html) confirms a language-specific reference, but no aligned BSL recording was available for replay. ASL motion rules are never applied to BSL. |
| ISL | THANKYOU is in the 263-class vocabulary; SORRY is absent. The [official INCLUDE dataset](https://huggingface.co/datasets/ai4bharat/INCLUDE) contains a Greetings/Thankyou class. No aligned local target recordings were available to validate the transformer. |
| LSE | Neither target was found in the 300-class health-domain vocabulary. |
| PSL | Neither exact target is in the 775-reference bundle. FORGIVE and EXCUSE(JUSTIFICATION) are different labels, not assumed equivalents. The bundle has one reference per class, limiting signer/style diversity. |
| Bangla | Neither target was found in the 401 shipped English-gloss labels. Its separate RGB capture flow is unchanged. |
| Russian | No exact спасибо/извин… target label was found. Related gratitude/regret labels are not treated as verified equivalents without native-language reference review. Its separate RGB capture flow is unchanged. |
| Other selectable languages / personal signs | Existing availability is unchanged. A selectable language or suggested practice word does not create a trained class. Reliable target recognition requires language-specific saved examples or a model/reference class. |

The same unevenly sampled kinematic THANK YOU and SORRY observations were compared against the original personal sampler. Mean absolute midpoint feature error decreased from 0.001466 to 0.000077 for THANK YOU, and 0.001726 to 0.000141 for SORRY. Both labels were already correct in these fixtures before and after: **this is a temporal-fidelity improvement, not an observed accuracy increase**. At 30 fps the old non-ASL buffer retained only 2.633 seconds; the new buffer retains the full 4.2-second test movement.

No new signer examples, language mappings, or accuracy percentages were invented. No recorded-sign before/after comparison was possible. Reliable claims require matched, language-labelled recordings covering variants, ordinary hand motion, incomplete signs, and transitions, with fluent review. Old personal examples recorded without body tracking may need re-recording because their translation was already normalized away.

**Verification**

- Full regression run: **881 passed, 5 failed, 1 skipped**, across 86 test files. Five failures remain in unchanged environment-dependent checks: one Windows symlink privilege failure, one dependency-junction resolution assertion, one path-separator assertion, and two Windows path-guard failures in the live-trial logging script. The suite is not wholly green.
- Final focused run: **48 passed**, including the added handedness invariant, time-based sampling/history, pose-loss trajectory, legacy-template compatibility, bounded capture, early hand output, worker recovery, GPU warmup fallback, runtime bundle, and evidence-dashboard checks.
- Existing passing regression coverage includes static signs, slow/fast and incomplete motion, ordinary/idle movement, pauses and re-entry, repeated-sign suppression, stale predictions, language switching, model load failure/recovery, and personal matching. These are automated fixtures, not webcam validation.
- TypeScript passed. Local Next.js production build passed and generated the existing 13 routes. Changed-file ESLint had no errors; its unused benchmark-variable warning was removed.
- Final controlled browser smoke passed: navigation, transcript isolation/copy, storage failure, delayed/denied/cancelled camera permission, duplicate speech suppression, confirmed-only announcements, and RSL/Bangla camera isolation. Five camera requests, one denial, four late tracks stopped. Camera/recognizer events in this smoke test are controlled, not real signing.
- The evaluation dashboard now explicitly marks old results as stale for the changed worker. No historical accuracy is attributed to this implementation.

**Reproducing the measurements and remaining webcam check**

After installing the normal project dependencies and pinned vision assets, run from the repository root:

```powershell
node scripts/diagnostics/benchmark-tracking.mjs --chrome 'C:/Program Files/Google/Chrome/Application/chrome.exe' --baseline e63fffe64e6cc7136cf5191bd3beb07058c24200
```

The diagnostic starts an isolated local Chrome instance, rebuilds the relevant workers, and writes `work/tracking-benchmark-results.json`. `--vision-assets PATH` may point to an existing public directory containing `vision/`; `--phases-only` measures classification/matching alone. No deployment is involved. The original baseline commit must be available locally.

For webcam acceptance, open the local app with `?perf`, then repeat the same language-specific signs at slow/normal/fast speed and small/large natural movement sizes. Include pauses, immediate repeats and separated repeats, hand exit/re-entry, incomplete strokes/circles, transitions, and ordinary non-sign motion. Compare matched recordings under the same camera/framing/light settings and record confirmations, abstentions, wrong accepts, capture-to-draw age, and completed tracking rate. Check mirrored overlay alignment and left/right signing. The fallback main-thread path remains functional but cannot provide the worker path's UI responsiveness guarantee. This live validation still requires the user; no webcam accuracy or under-150-ms sensor-to-photon result is claimed.
