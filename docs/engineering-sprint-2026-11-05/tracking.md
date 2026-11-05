# Camera lifecycle and performance

## Changes and regressions

| Severity and affected path | Root cause and correction | Evidence and compatibility |
| --- | --- | --- |
| High, camera stall during busy tracking | The workspace compared the video clock to the last **analysed** frame. If the camera stopped with a later frame while the lane was busy, that same clock value looked new at every animation tick. `components/translator-experience.tsx` now tracks the last video clock observed independently of frame dispatch. | `tests/fault-injection-smoke.mjs` freezes the video clock just ahead of the last picked-up frame and blocks bitmap capture. The candidate reported the timeout and released its tracks. The eight-second policy and frame sampling cadence are preserved. |
| High, recognition watchdog and clock corrections | `lib/recognition-session.ts` used the wall clock for deadlines, recovery windows, and queue and round-trip measurements. It now uses the main-thread monotonic clock. Resetting a failed lane no longer silently restarts it after the restart limit. | `tests/recognition-session.test.ts` moves system time forward and back independently of elapsed time and checks duration measurements and watchdog recovery. It also checks that reset respects the recovery limit. Session and storage formats are preserved. |
| Medium, a decoded-frame snapshot fails in local fingerspelling | `lib/live-vision.ts` held an obsolete bitmap and a sticky error after snapshot creation failed. It now closes the old bitmap and reports the failure once, so later snapshots can reach the tracker. | `tests/live-vision-capture.test.ts` forces a failed snapshot between successful frames, checks bitmap disposal, and confirms delivery resumes. The one-slot buffer, local research boundary, and CTC model are preserved. |
| Medium, tracked worker did not reflect the alpha source | The checked-in vision bundle predated the per-part timing and opt-in auxiliary schedule already present in alpha. The sprint rebuilt the tracked vision and recognition workers with the locked esbuild. | The export verifier checks the generated recognition worker against the committed worker. The paired vision measurements below use the same newly built tracker for both versions, consistent with how the alpha build regenerates workers. |

Opt-in `?perf` now measures capture start to completed canvas drawing and includes bounded Long Task durations where the browser supports them, vision recovery counts, and replaced research snapshots. The existing readout includes bitmap capture, hands, auxiliary processing, transport residual, recognition queue wait and round trip, classification, model and matching work. The frame loop takes the overlay sample from tracking delivery age plus draw duration. It excludes injected rehearsal overlays and counts only numbers. Worker durations are measured within the worker clock. Queue and end-to-end durations use the page clock. No absolute worker timestamp is subtracted from a page timestamp. The transport residual includes message and scheduling costs and does not isolate worker queue wait. The capture-to-overlay sample begins at browser capture, after any sensor and decoder delay.

## Paired MediaPipe worker timing

Chrome 156.0.8078.80 on Windows, Intel Core i7-10510U, Node 24.22.1. The runner loads the real self-hosted MediaPipe gesture, face, and pose tasks and uses 640×480 generated RGB with no person. It bundles `LiveVision` at the verified alpha SHA and the candidate on the same host and serves the identical built worker and pinned assets to both. Each row starts a fresh tracker and records the first frame, then summarises 24 steady-state frames after five warm-up frames. The run order alternates. A Chrome process and HTTP cache can be warm. These runs overlapped local builds and tests. The timings characterize that loaded environment.

| Requested path | Pair | Baseline startup / first frame, ms | Candidate startup / first frame, ms | Baseline overlay median / p95 / max, ms | Candidate overlay median / p95 / max, ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| CPU | 1 | 10,374 / 169 | 6,821 / 327 | 153 / 248 / 258 | 282 / 461 / 639 |
| CPU | 2 | 5,312 / 466 | 7,735 / 332 | 154 / 610 / 628 | 210 / 289 / 298 |
| CPU | 3 | 5,442 / 311 | 4,913 / 208 | 169 / 247 / 363 | 149 / 236 / 261 |
| Acceleration requested, CPU fallback | 1 | 15,470 / 181 | 13,712 / 153 | 139 / 187 / 229 | 168 / 296 / 366 |
| Acceleration requested, CPU fallback | 2 | 9,105 / 181 | 12,196 / 233 | 167 / 270 / 308 | 172 / 273 / 338 |
| Acceleration requested, CPU fallback | 3 | 9,953 / 268 | 12,012 / 190 | 162 / 222 / 368 | 145 / 190 / 231 |

The direction and size of the differences varied across runs. There is no measured p95 improvement to attribute to the candidate. All 12 result rows were recorded before Chrome's Windows profile cleanup returned `EBUSY`. The harness now waits for Chrome to exit and retries cleanup. There were too few samples per run for p99. GPU, physical camera arrival, sustained-memory behaviour on real signing, and time from signing to suggestion or speech require device runs. The benchmark measures real pinned inference on a no-hand control and cannot establish recognition accuracy.

```powershell
npm ci
npm run install:vision-assets
npm run build:worker
node scripts/benchmarks/alpha-tracking-paired.mjs "C:\Program Files\Google\Chrome\Application\chrome.exe" 900dca8e14ef0daa985c40729304628bde97024c tracking-paired.json
node tests/fault-injection-smoke.mjs "C:\Program Files\Google\Chrome\Application\chrome.exe"
```

The [recognition report](recognition.md) separately covers the matcher and actual model workload. Avoid pooling CPU fallback with hardware GPU results or comparing numbers from a different host to these baseline measurements.
