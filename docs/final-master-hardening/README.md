# SignRelay engineering hardening

November 6, 2026. The baseline is [PR #59 at `2142d22ba150fdfd12de3997550ad846ed7af616`](https://github.com/adamjamiesimson/SignRelay/pull/59). This branch is for review and protected engineering tests. The approved interface and recognition confirmation policies were preserved.

## A. Application inventory and changes

| Area | Paths traced and behavior checked |
| --- | --- |
| Camera, decoding and scheduling | `components/translator-experience.tsx` owns permission, playback, generation, interruption, and stop. `lib/live-vision.ts` bounds conversion to one native bitmap request and one frame in flight. `lib/decoded-frame.ts` maps immutable WebCodecs frames or callback times. Fingerspelling has a separate bounded decoded snapshot and drain path. |
| MediaPipe, drawing and worker recovery | `workers/vision.worker.ts`, `lib/vision-engine.ts`, and `lib/landmark-overlay.ts` separate early hand drawing from the full frame used by recognition. The worker probes before readiness and can move from GPU to CPU. Repeated worker faults now end the camera session and release resources. Invalid vision frames are rejected before drawing or inference. |
| Word recognition | `lib/recognition-session.ts` has a one-in-flight and one-latest mailbox, a watchdog and a session fence. `workers/recognition.worker.ts` arbitrates ASL starter rules, personal matching, motion-gated ASL/BSL/ISL/LSE inference and PSL matching. Invalid observations clear temporal evidence while acknowledging the frame. The UI rejects malformed analyses and transcript timestamps. |
| Other languages | RSL and Bangla have separate capture components and ONNX workers. They emit isolated-sign suggestions. Unsupported automatic workspaces use language-scoped personal templates. |
| Local persistence and matching | `lib/calibration-storage.ts` validates legacy and current formats and uses a single write transaction for save and prune, delete or clear. A committed change now invalidates open tabs, which suspend personal confirmation until their latest successful re-read. `lib/template-transport.ts` and the matcher worker transfer packed templates and fence asynchronous results. |
| Transcript, suggestions and speech | `lib/model-output-policy.ts`, `lib/model-suggestion.ts`, `lib/browser-storage.ts` and the workspace manage visible, waiting and expired offers, ordering, deliberate Add, transcript edits, speech and local history. Research model and public starter outputs remain suggestions. |
| Navigation and accessibility | Public routes include home/workspace, language directory, how-it-works, models, about, privacy, roadmap and terms. The existing onboarding, keyboard interaction, live regions, responsive layouts and reduced-motion rules are exercised through the available rendered and browser suites. |
| Privacy and research | `/study` and `/field-test` are private export options. Consent, export, withdrawal and signer split are defined in the [study protocol](../evaluation/signer-study/PROTOCOL.md). The local static server now binds private and marked research exports to loopback and requires TLS options for a LAN bind. These responses use `no-store`. |
| Supply chain and releases | The lockfile, model assets, checksum contracts, public flags, export pruning, generated workers, Firebase hook, Vercel build and CI workflows form the release boundary. This branch is explicitly excluded from automatic Vercel deployment. The local server now streams assets with backpressure and returns file metadata for HEAD. |

## B. Bug register

| Severity | Reproduction and root cause | Fix and regression |
| --- | --- | --- |
| High | Fail tracking workers repeatedly while there is no pending frame. The UI counted rejected frame promises, so idle and conversion-time crashes could avoid the stop limit. | Cap automatic replacements to two in 60 seconds. On terminal failure, stop camera, bitmap work and worker. Unit and built-browser failure injection cover the path. |
| High | Offer a word, then interrupt the vision worker during capture. The tracker reset recognition evidence but left the earlier suggestion available for acceptance. | Withdraw suggestions in the same interruption handler that clears overlay and recognition state. Browser fault injection offers a word before crashing the worker and checks immediate withdrawal. |
| High | An open tab holds examples in its matcher after another tab removes them from IndexedDB. Existing invalidation was local to the mutating tab. | Broadcast after commit, invalidate personal output before re-reading and fence older snapshots. The two-tab Chromium test removes a real IndexedDB record through the UI and inspects the other tab’s worker configuration. |
| High | Private study and research exports could listen on every interface by default, while the documented HTTP phone address could not grant camera permission. | Loopback by default, explicit TLS key and cert for LAN, no-store for restricted assets. Negative bind and positive loopback tests. A separately generated loopback certificate also passed an HTTPS request with explicit trust and hostname verification. |
| Medium | Null, nonfinite or incomplete landmarks crossed the vision and recognition worker boundaries. Some values threw in later consumers, and negative observation times could become recognition evidence. | Validate at the boundaries, reset evidence on invalid observations and preserve the acknowledgement. Tests inject null points, nonfinite coordinates, malformed results and invalid times. |
| Medium | An analysis with a React-incompatible candidate object or invalid metadata could reach the workspace. A finite negative transcript timestamp passed the session gate. | Reject invalid analyses and recover within the existing restart budget. Drop malformed transcript payloads before speech or insertion. |
| Medium | Three slow clients requesting Slovo caused the local server to read three complete 140,785,735-byte files before responding. HEAD also read the complete file. | Stream from an open file handle, honor response backpressure, and derive HEAD from file size. GET, HEAD, privacy and encoded-path regression checks. |
| Low | On Windows a percent-encoded backslash passed the URL dot-segment check before Windows resolved it as a separator. | Reject backslashes in decoded URL paths before file resolution. |

Device-specific GPU hangs and real-world fast-motion lag remain outside the conclusions of these fixes. The benchmark and test environments are listed below.

Seven selected crash, malformed-message and unsafe-bind regressions failed against the unchanged PR #59 source in an isolated checkout, as expected. The corresponding candidate cases pass.

## C. Tracking and performance

The [historical PR #59 licensed RGB run](https://github.com/adamjamiesimson/SignRelay/actions/runs/42199749969) used 26 paired CPU replays on exposed FSboard clips. Split tracking delivered 1,937 frames versus 1,527 combined, with 2,215 versus 2,625 dropped. The median of per-clip fast-motion draw p95 was 121.0 ms split and 123.0 ms combined. Overall draw p95 was 124.0 ms split and 119.9 ms combined. Split delivered 126 frames without fresh auxiliary cues and produced 15 clips with unsupported starter candidates versus 14 combined. The production combined schedule was retained.

The local baseline/candidate MediaPipe comparison used generated 640×480 RGB, 24 measured frames per run and no hands. It exercised real worker capture and WASM. All accelerated requests fell back to CPU on this host. Timing was heavily affected by concurrent host load, and the run predates the final frame validator. It provides a runtime control only. The local server throughput and memory measurements are separate from tracking.

For the three explicitly CPU runs, capture-to-overlay p95 ranged from 407–978 ms at baseline and 264–1,035 ms on the candidate. On the three accelerated requests that landed on CPU, p95 ranged from 241–798 ms at baseline and 278–379 ms on the candidate. The run did not measure fast real hands or actual presentation. Run `node scripts/benchmarks/alpha-tracking-paired.mjs CHROME 2142d22ba150fdfd12de3997550ad846ed7af616 REPORT.json` after building the pinned vision worker and assets to reproduce the synthetic comparison.

For local model serving, three stalled GET clients requested the verified 140,785,735-byte Slovo asset on loopback. Baseline and candidate ran A/B/B/A, with separate Node processes and 25 ms memory sampling. Peak RSS was 452.9–453.1 MiB for PR #59 and 51.3–51.6 MiB for the candidate. Peak ArrayBuffer memory was 402.9 MiB and 1.58 MiB respectively. This models backpressure from slow clients, with no browser, inference or sensor involved.

### Physical-device diagnostic

1. Use the protected local server from the [study protocol](../evaluation/signer-study/PROTOCOL.md). Open the same build on the target laptop and phone with `?perf` appended to the URL. Check the commit in `/runtime-manifest.json`, camera permission and the tracker delegate.
2. On each device, let the camera settle for 15 seconds. Compare PR #59 and the candidate in A/B/B/A order. Keep browser, lighting, distance and device power mode fixed. Repeat slow, natural and fast sweeps, a direction reversal, wrist rotation, two-hand crossing, and brief occlusion followed by recovery.
3. Record the capture-to-overlay p50/p95 readout, frame rate, visibly trailing overlays, freezes, hand loss and time to recover. Record device, browser, delegate and any fallback. Save only the numeric readout or a crop without a camera image. The capture-to-overlay measurement starts inside the browser.
4. Pause, reconnect and close the workspace. Check that the device camera indicator turns off. Stop the local server when the run is complete.

## D. Recognition and dynamic signs

The following results come from the [PR #59 WLASL run](https://github.com/adamjamiesimson/SignRelay/actions/runs/42199749896). All 176 clips were exposed development data. The counts are **correct / wrong / abstained**, on each expected sign. Other-sign false accepts are counted separately.

| Expected sign | Support | Starter | Frozen DTW | Articulated | Guarded |
| --- | ---: | ---: | ---: | ---: | ---: |
| HELLO | 2 | 1/0/1 | 0/0/2 | 0/1/1 | 0/1/1 |
| NO | 6 | 6/0/0 | 0/0/6 | 1/0/5 | 0/0/6 |
| PLEASE | 5 | 5/0/0 | 1/0/4 | 2/0/3 | 1/0/4 |
| SORRY | 3 | 3/0/0 | 1/0/2 | 1/0/2 | 0/0/3 |
| THANK YOU | 4 | 1/0/3 | 0/0/4 | 1/0/3 | 1/0/3 |
| YES | 7 | 0/0/7 | 3/0/4 | 2/1/4 | 1/1/5 |
| False accepts on 149 other signs | 149 | 30 | 10 | 7 | 7 |

Misses are wrong outputs plus abstentions on target clips. I LOVE YOU was outside the six-target cohort. Clip-based evaluation gives no live completion latency. The change here hardens observation validity and temporal reset. It does not establish greater recall or a latency improvement for dynamic signs. The ASL-2000 training/live landmark mismatch remains documented in [the model diagnostics](../evaluation/asl2000-sprint8). Thresholds, segmentation and model adoption require independently labelled new signers, including fast and interrupted movement, left/right dominance, repeated signs and negative controls. The PopSign RGB pilot stopped at the publisher’s distrusted emSign G3 certificate chain. [Historical acquisition log](https://github.com/adamjamiesimson/SignRelay/actions/runs/42199749950/job/127831816217).

## E. Personal vocabulary

The original schema and legacy ASL default are preserved. Cross-tab refresh is asynchronous and starts when another tab receives the invalidation. Its message carries no sign labels, timestamps, examples or video. If a refreshed read fails after invalidation, stale personal matching stays suspended until a valid snapshot is available.

The paired Node worker benchmark completed 42 sessions across 0, 1, 6, 30, 150, 300 and 1,000 synthetic templates. It measured 141 acknowledgements per version and size. At 1,000 templates the baseline/candidate acknowledgement p50 was 1.37/3.48 ms and p95 was 6.09/15.51 ms. At 150 templates the order reversed, with p50 11.57/2.01 ms and p95 58.97/31.66 ms. This contended run does not establish a stable matcher throughput change. The matcher algorithm and storage schema were unchanged.

The Chromium rehearsal used real IndexedDB at 30, 150 and 300 examples. It passed all six checks, including searching beyond the first 80 listed words, removing three examples, surviving reload and invalidating a second tab without reloading it. The Node comparison can be repeated with `node scripts/benchmarks/recognition-sprint.mjs 2142d22ba150fdfd12de3997550ad846ed7af616 RESULTS_DIRECTORY`.

## F. Installed model validation

The full build verifies pinned RSL Slovo, Bangla VideoMAE, Spanish SWL-LSE and PSL HFAD assets. ASL-2000, BSL-1064 and ISL-263 use separate installed checkpoint and label contracts. No model weights or label maps were replaced. Execution evidence and synthetic-only coverage are distinguished in the test ledger below.

The paired worker benchmark exercised the real ASL-2000 weights and 775 PSL templates. Both versions agreed on the synthetic input. The ASL model labelled the synthetic HELLO motion as DIVE. It is an inference-path check with a wrong label and no signer-accuracy implication.

| Runtime | Execution evidence |
| --- | --- |
| ASL-2000, BSL-1064, ISL-263 and LSE-300 | Real Chromium runtime probes completed fresh and cached inference, fenced a cancelled request, and reproduced matching outputs. A separate local WASM run confirmed 1,064, 263 and 300 finite logits for BSL, ISL and LSE. BSL and ISL abstained and LSE offered RIÑON on the synthetic input. |
| PSL HFAD | Ran the installed 775-reference matcher in the paired benchmark and verified its bundle and label checksums. |
| RSL Slovo and Bangla VideoMAE | Both headless Chrome reruns passed. Each loaded the installed ONNX model, captured fake-camera frames, ran inference, abstained and released the camera on cancellation. Initial Windows runs exited after all application assertions due to a locked Crashpad profile. The harness now asks Chrome to close before deleting its profile. |
| Personal-only workspaces | Exercised language and worker fences and workspace switching. The IndexedDB browser scale run used the ASL workspace. |

## G. Release boundaries

Public checks inspect the static artifact and reject private routes and markers, research models and workers, and automatic starter output. No account credentials or signer recordings are required to build the public artifact. Hosted build simulation and GitHub checks are separate from deployment. [Vercel Git configuration](https://vercel.com/docs/project-configuration/git-configuration).

## H. Test ledger

Host for local tests is Windows with Node 24.22.1. GitHub workflows use their pinned runner configuration and are reported separately. Subprocess tests required the host runtime because the Windows sandbox prevented some child processes from starting.

| Check | Result |
| --- | --- |
| Complete Vitest run | 1,241 passed, 0 failed, 7 skipped across 124 files. Windows Node 24.22.1, native Python on PATH, two test threads and a 30-second per-test timeout for this host. |
| Final focused rerun | 136 passed across six files after the last interruption and protected-export changes. |
| Focused tracking, capture, recognition, suggestion and private server regression | 132 passed, 0 failed, 0 skipped across six files. |
| Final sparse-landmark follow-up | 80 passed, 0 failed, 0 skipped across the vision and recognition worker suites. |
| Dataset isolation | 12 passed with native Python on PATH. The earlier Windows run used a launcher that the test subprocess could not execute. |
| Python transport and artifact regression | 19 passed across the secure download and landmark artifact suites. |
| Locked dependencies and advisory gate | Clean `npm ci` installed 404 packages. Registry audit reported 0 production and 0 full-tree advisories. |
| Secret and asset policy | The existing credential rules scanned the working tree and 2,470 historical text blobs across 585 fetched commits, using batched Git reads on Windows. Zero findings. Repository asset policy passed. |
| TypeScript, lint and worker rebuild | TypeScript and changed-source lint passed. Rebuilt the worker with the locked esbuild and MediaPipe versions. Its SHA-256 is `b35058f1803bccdc65131d8431d44177e04ec71d259bdca36c4d28d9d7651a0b`. The historical dashboard now names this hash as unevaluated. |
| Full static export | Windows Turbopack could not connect to a PostCSS child process. Next.js with `--webpack` compiled the export and passed the same runtime and public export guards. Both rendered HTML tests passed. |
| Public Chromium | Production isolation 5 checks, workspace 12 checks, fault injection 9 checks and axe 6 surfaces with zero violations. Firefox and WebKit browser coverage was unavailable in this environment. |
| Suggestions and speech | All 23 Chromium checks passed, including ordered and expired cards, stale worker events, speech and a 375 px viewport. The immediate-activation check pins the test browser’s monotonic clock so test-control latency cannot age its input. |
| Rehearsal lifecycle | 12 start/pause cycles, 6 rapid start/cancel toggles, hidden-tab recovery, disconnection and 3 workspace re-entries. The Chrome probe sampled 5 MiB JS heap at both endpoints. This two-point measurement covers the page heap only. |
| Rehearsal transcript | Both six-word runs returned four expected words in order. The mailbox replaced 50 offered frames (25% and 26%) in the two runs. The test assertion was retained. |
| Offline ASL demo | Export and strict network isolation passed with zero app requests outside loopback. The separate performance contract measured a 21,725 ms cold start under load and failed its 15,000 ms limit. The isolation run reported 4.5 analysed frames/s and displayed the existing 10 frames/s warning. |
| Hosted preview replay and preflight | The local Vercel preview command sequence passed with webpack in place of Turbopack. Five injected private capture, research export, fingerspelling, automatic starter and rehearsal overrides refused before artifact creation. This exercised the local build commands and artifact, not the hosted project. |
| Protected export and study | The local export retained the private study and capture routes. The public guard refused it. All six protected Chromium checks passed for consent, split assignment, task timing, scoring, export validation and deletion. The synthetic session made no uploads and axe reported no study-panel violations. |
| Loopback asset memory | Four runs completed. See section C. |

The second engineering pass reproduced malformed payloads and worker failures on the baseline, tightened sparse-array validation, fenced competing vocabulary snapshots, and checked the private and research export markers. This was an engineering self-review.

## I. Open evidence requirements

| Dependency | Remaining requirement |
| --- | --- |
| Engineering | Reproduce the ASL cold-start and transcript throughput misses on a quiet target device before changing the scheduler. Any candidate needs a matched comparison against the combined worker with identical motion, decoding, CPU load and cue-age bounds. |
| Devices | Measure phones, camera sensor/display delay if instrumented, GPU behavior, background suspension and long sessions on representative devices. |
| New signers | Collect consented independent ASL cohorts with annotated boundaries. Repeat for other languages before estimating reliable vocabulary or recognition accuracy. |
| Licensed data | A new unexposed cohort and checksum-verified RGB from the publisher are needed for independent evaluation. |
| Owner | Review the private dry run, firewall and certificate trust setup, and consent process before participant recruitment. |
| External services | PopSign publisher certificate and hosted CI availability. |

## J. Stack and handoff

The earlier ancestry includes `main` at `e63fffe` → [#44](https://github.com/adamjamiesimson/SignRelay/pull/44) `fc95a6f` → [#45](https://github.com/adamjamiesimson/SignRelay/pull/45) `e0b1f35` → [#46](https://github.com/adamjamiesimson/SignRelay/pull/46) `6eb9c64` → `996b0d2` → [#47](https://github.com/adamjamiesimson/SignRelay/pull/47) `fa97370` → [#48](https://github.com/adamjamiesimson/SignRelay/pull/48) `d89cff6` → [#49](https://github.com/adamjamiesimson/SignRelay/pull/49) `116fe68` → [#50](https://github.com/adamjamiesimson/SignRelay/pull/50) `d8cfefc`. The succeeding stack is [#51](https://github.com/adamjamiesimson/SignRelay/pull/51) `7009705` → [#52](https://github.com/adamjamiesimson/SignRelay/pull/52) `a213be7` → [#53](https://github.com/adamjamiesimson/SignRelay/pull/53) `1e53d61` → [#54](https://github.com/adamjamiesimson/SignRelay/pull/54) `632607f` → [#55](https://github.com/adamjamiesimson/SignRelay/pull/55) `6674c90` → [#56](https://github.com/adamjamiesimson/SignRelay/pull/56) `900dca8` → [#57](https://github.com/adamjamiesimson/SignRelay/pull/57) `6f5592b` → [#58](https://github.com/adamjamiesimson/SignRelay/pull/58) `6fad3a4` → [#59](https://github.com/adamjamiesimson/SignRelay/pull/59) `2142d22` → `codex/signrelay-final-master-hardening`. PR #54 uses the RC alias branch at the exact #53 head.

Reproduce from the candidate checkout with `npm ci`, `npm run typecheck`, `npm test`, `npm run lint`, `npm run build:firebase`, `node scripts/assert-public-export.mjs out`, and `npm run test:rendered`. The Firebase command produces a local export. Verify the reported commit and worker SHA in `out/runtime-manifest.json`.

The initial reviewed tree was published as `c0828de835906dd21419dc23a4973699c916ddd7` on [draft PR #60](https://github.com/adamjamiesimson/SignRelay/pull/60), stacked on PR #59. Automatic Vercel deployment is disabled for this branch. The [follow-up report](FOLLOW-UP.md) records later changes, their checks and the remaining limits.

## K. Readiness judgments

- Protected engineering dry run. Use the loopback or trusted TLS procedure with synthetic data after the applicable build and browser gates pass.
- Supervised alpha. First verify the candidate and secure camera access on the devices the facilitator will actually use. Review consent and withdrawal handling before collecting participant data.
- Public release. Recognition accuracy and physical-device performance need independent evidence before public qualification.
