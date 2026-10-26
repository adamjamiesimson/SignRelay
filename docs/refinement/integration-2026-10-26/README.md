# Integration and release-candidate report — 26 October 2026

**Engineering verdict: GO for supervised human testing, subject to each real device passing the existing preflight. Public release: NO-GO.** No webcam session, new signer collection, independent fluent review, or sealed-holdout evaluation was performed. The Windows headless measurements do not meet the existing 10 analyzed-fps device preflight or consistently meet the 100–150 ms tracking goal. Passing CI is not a claim of reliable sign recognition.

Draft [PR #44](https://github.com/adamjamiesimson/SignRelay/pull/44), branch `codex/integration-release-candidate`, integrates main `e63fffe6`, Sprint 7 / PR #42 `29ddeb96` (including #39–41), and tracking PR #43 `06316aa7`, with stabilization code at `b0cb1d193cbc24d9ce76cc72029b1436a930933a`. Original branches were preserved. Nothing was merged into main or deployed to Firebase. No production deployment was requested.

## What changed and why

The tracking refinement moves synchronous MediaPipe inference from the UI thread into a persistent worker. Previously the overlay waited for hand plus scheduled face/pose inference. Inspection found no unbounded recognition FIFO or per-frame model reload: the material problems were blocking inference, waiting for auxiliary results, expensive classification, and loss of trajectory in some personal examples. The user's approximately one-second live-camera trail was not directly reproduced.

- One capture/inference slot bounds tracking work. Busy frames are discarded before bitmap allocation; the next free tick captures current video. Hand results publish before auxiliary inference and independently of classification. Canvas draws use current landmarks without extra React renders when visibility flags are unchanged. Existing preview mirroring and object-fit alignment remain.
- GPU warmup is probed; a stalled or failed GPU worker is terminated and replaced with CPU. Unsupported platforms retain a CPU main-thread fallback, which cannot offer the worker path's UI responsiveness. Integration adds startup cancellation, immediate worker termination on stop/unmount, and protection against a bitmap captured for an obsolete worker being posted into its replacement. Model instances are reused.
- Recognition retains bounded latest-frame handling and separate reference matching. Histories now cover elapsed time (4.5 seconds, at most 300 observations); personal sequences are resampled by time. New `trajectory-v3` examples preserve body-relative position and travel through pose dropout, with a fixed initial wrist anchor when body tracking is entirely absent. Absolute body position cannot be recovered in that case. Legacy examples remain readable but missing motion cannot be reconstructed; some need recording again.
- Sprint 5's packed, transferred template buffers and eager personal matcher initialization remain intact. Added transport coverage verifies the new trajectory format survives packing. DTW, direction, hand orientation, handedness, sequence completion, ambiguity, confidence, temporal consistency and repeat-suppression safeguards remain; thresholds were not lowered.
- Sprint 7's interface, language availability labels, consent/privacy controls, all supported languages, transcript, speech and personal-sign features remain. Russian and Bangla retain their separate capture paths.

Detailed initial implementation and language-specific references remain in [the tracking report](../../tracking-refinement-2026-10-25.md). That document is historical; the measurements and replay evidence below describe the integrated candidate.

## CI repair and Windows portability

PR #43's audit failures involved `@vitest/mocker` advisories GHSA-qxg6-89mg-rqv8 / GHSA-xp26-3454-mjgp and zod GHSA-mrhx-c7xc-m3w5. Integration retains Sprint 7's patched Vitest/mocker 4.1.12 and zod 4.6.7. Full and production audits report zero advisories; no exceptions or security gates were weakened.

The RSL download failures were transport `ECONNRESET`, not model-format failures. Sprint 5's downloader provides four bounded attempts, 5/15/45-second backoff, a 300-second timeout, streamed size/SHA verification and atomic rename. Cached assets are rehashed; invalid bytes do not qualify for transport retries. The local download reproduced one reset and then succeeded with a verified model. Full multilingual and pilot builds passed in CI.

The offline smoke observed page traffic but missed worker model requests. The diagnostic now attaches to workers before script execution, enables network monitoring and blocking there, and observes actual self-hosted hand/face/pose models and WASM. It preserves normal cache policy by default. Fault tests explicitly disable cache, block worker and page CDN fallbacks, and serve real corrupt bytes through a loopback fixture because this Chrome worker target does not support CDP Fetch interception. Detached workers reject pending diagnostic commands immediately. Offline, lifecycle and fault checks count the recognition lane, not unrelated worker messages.

The five original Windows failures are repaired: canonical real paths and separator normalization for two fast-glob checks; a real directory junction exercises outside-root symlink rejection where Windows refuses file symlinks; `relative`/`isAbsolute` containment fixes both logger path guards while retaining sibling/traversal rejection. A shell-free Node CLI launcher handles Windows npm/npx. The exhaustive illustration check retains all coordinate assertions but collects failures rather than allocating assertion stacks for every valid coordinate.

## Tracking and computation measurements

Raw [benchmark JSON](tracking-benchmark.json). Same Windows x64 i7-10510U @ 1.80 GHz, Chrome 155.0.8059.86, generated 1280×720 **no-hand canvas**, pinned real MediaPipe, five warmups and 20 measured frames per mode. Paired baseline is main `e63fffe6`. Times are median / p95 in milliseconds. These measurements exclude camera exposure/driver buffering and actual display presentation; empty-overlay rendering does not measure drawing a tracked hand.

| Stage | Main-thread baseline | Integrated default, CPU-worker fallback |
| --- | ---: | ---: |
| Bitmap capture | direct input | 0.2 / 0.4 |
| Hand inference | 123.1 / 228.9 | 155.2 / 277.7 |
| Auxiliary inference per processed frame, including skips | 58.9 / 146.6 | 86.2 / 172.4 |
| Tracking transport residual | n/a | 0.6 / 1.4 |
| Empty overlay draw | 0.0 / 0.1 | 0.0 / 0.2 |
| Capture start to overlay draw | **187.0 / 368.3** | **155.7 / 278.6** |
| Full tracking operation | 187.0 / 368.3 | 221.7 / 376.4 |
| Animation-frame interval | 20.9 / 208.5 | **20.9 / 21.2** |
| Empty-frame classification | 0.1 / 0.3 | 0.2 / 0.4 |
| Recognition communication residual | 0.9 / 1.8 | 0.0 / 1.0 |

GPU warmup stalled on this device; automatic CPU recovery worked. A separate forced-CPU-worker run was worse: capture-to-draw **305.4 / 531.9 ms**. Samples vary with load; the older PR #43 result (121/232 → 74/151 ms) remains historical and is not substituted for this run. The worker architecture improves UI continuity and avoids auxiliary wait before drawing, but does not make inference itself faster. There is no video backlog in the bounded lane; low update rate still limits perceived tracking.

Five warm classification samples with real cached assets and the existing kinematic SORRY fixture, excluding download and including cooperative yields:

| Computation | Median / p95 ms |
| --- | ---: |
| ASL-2000 neural inference | 2,116.1 / 2,880.0 |
| Six personal examples | 28.9 / 39.3 |
| PSL 775-reference scan | 786.5 / 1,227.8 |

A separate five-run ASL CPU profile took 11,857.6 ms: `applyGraphLayer` accounts for 6,467 of 7,380 samples (87.6%); idle 791, GC 51. Warm graph computation dominates, not download or worker messaging. No speculative arithmetic, weight or acceptance changes were made. These timings are isolated computation, not production end-to-end decisions or accuracy. The prior 1,275 ms ASL result had different load and does not establish a controlled regression.

Local offline smoke cold starts were 14.123, 9.168 and 9.028 seconds with 5.25, 4 and 4 recognition frames/second. Linux CI fake-camera runs reached about 15.2 fps and 46/51 ms frame age on a different machine; they are not a paired Windows comparison. No sensor-to-photon or consistently sub-150-ms webcam claim is supported.

## Real-video replay and dynamic signs

The [pilot CI run](https://github.com/adamjamiesimson/SignRelay/actions/runs/40287458234) replayed the same 11 permitted historical/development videos. [Unmodified derived artifact files](ci-pilot/) and the [generated dashboard](development-dashboard.md) retain per-trial provenance. Artifact 12634773576 ZIP SHA-256: `6c9496adb10f9915ed338e8b6010d091876354738211e586e76fc8917f9e7d56`. No video, landmark arrays or consent records are committed.

**5 correct, 0 wrong accepted, 6 abstained, 0 errors.** The established-baseline gate passes with zero changes and zero exceptions. The much older frozen pre-PR28 comparator has one wrong acceptance; its removal predates this integration and is not a new improvement.

| Gloss | Trials | Correct | Abstained |
| --- | ---: | ---: | ---: |
| HELLO | 3 | 1 | 2 |
| PLEASE | 3 | 3 | 0 |
| THANK YOU | 3 | 0 | 3 |
| NO | 1 | 1 | 0 |
| YES | 1 | 0 | 1 |
| SORRY | 0 | — | — |

THANK YOU tracked a hand in only 25/98 sampled frames, but this alone does not establish why all three trials abstained. SORRY has no real recording here. Kinematic fixtures verify sequence mechanics, incomplete-motion rejection and sampling fidelity; they do not prove human recognition accuracy. There are no idle/OOV trials in this replay, and no new independent fluent review. Sealed-holdout data was not accessed.

Target coverage remains language-specific: ASL includes both; BSL includes SORRY but no THANK YOU class; ISL includes THANKYOU but no SORRY. Neither exact target exists in shipped LSE, PSL or Bangla vocabularies. Related Russian gratitude/regret labels are not assumed equivalent without native-language review. Missing classes cannot be fixed by confidence tuning. Non-ASL target recordings and fluent review are still missing. See the original tracking report for model inventories and language-specific references.

The evaluated-runtime registry appends worker SHA-256 `4d1b5d73cace0cec3ae97f05d6bf10d6704fd8b3ad9aed5371824f82a103ca43` with this evidence. Older runtime entries and historical outcome files are preserved. The new dashboard describes byte-identical current recognition code; the old reports remain historical. The old dashboard's provenance banner now points to the separate current-runtime evidence; its outcomes are unchanged. The initial targeted check caught that stale banner; regeneration fixed it. Final dashboard/report/runtime tests: **21 passed across three files**. The copied baseline gate, evaluated-runtime verification and repository guard also pass.

## Verification and known failures

Machine-readable evidence: [CI](ci-verification.json), [Windows checks](local-verification.json). All six workflows passed on code commit `b0cb1d1`:

- [Core CI](https://github.com/adamjamiesimson/SignRelay/actions/runs/40287458213): **946 passed, 0 failed, 2 skipped, 92 files** (40.56 seconds).
- [Firebase static build and strict audit](https://github.com/adamjamiesimson/SignRelay/actions/runs/40287458382): the same full-suite counts (54.24 seconds), multilingual build and strict zero-advisory audit. This workflow builds; it does not deploy.
- [ASL video pilot](https://github.com/adamjamiesimson/SignRelay/actions/runs/40287458234): replay, exact baseline gate and failure-path/frame-step controls.
- [Offline demo and rehearsal](https://github.com/adamjamiesimson/SignRelay/actions/runs/40287458158): both profiles, deny-all proxy, planted page/worker leak detection, lifecycle/faults, personal-sign persistence/removal, keyboard/transcript/mobile, axe and runtime checks.
- [Private capture browser smoke](https://github.com/adamjamiesimson/SignRelay/actions/runs/40287458125): private capture metadata/download, interruption and no-upload behavior.
- [Analytics consent](https://github.com/adamjamiesimson/SignRelay/actions/runs/40287458153): consent, rejection and withdrawal.

Compared with Sprint 7's 926 passing / 2 skipped / 89 files, CI has 20 additional passing tests and three additional files. Secret scanning covered 672 commits and 1,888 historical text blobs with zero findings. Full and production dependency audits both have zero advisories.

Local Windows typecheck, lint, full multilingual build, workspace/lifecycle/fault/offline/axe/rendered checks and repository guard passed. Focused portability checks: 56 passes / 6 files; lifecycle: 34 / 4. Lifecycle exercised 12 restarts, six cancellations, three hand exits/re-entries, hidden/resumed tabs and external track stop. Collected page heap stayed about 5 MB before/after; this is not a total process/WASM memory proof. Static recognition, language changes, packed personal templates, worker recovery, repeat suppression and ordinary-motion rejection have automated coverage. Browser sign inputs are controlled, not a webcam signer.

Known failures and superseded attempts are retained:

- Final Windows full suite: **945 passed, 1 failed, 2 skipped** in 92 files. The existing everyday-movement ASL tail-guard exhausted its 300,000 ms timeout. Its isolated rerun passed in 71,449 ms with the original timeout unchanged. This does not make the Windows full run green. Both Linux full runs passed. Earlier loaded Windows runs had seven and two timeout failures respectively.
- Local full-history secret scan exceeded the runner's 600-second budget; the full-history CI scan passed. No gate was waived.
- Local video retrieval failed issuer-chain validation from the official host in Python and Node (including system trust); TLS verification was retained. CI retrieved and replayed the same authorized clips successfully.
- Initial offline observation with caching disabled took 15.706 seconds and failed the existing 15-second limit. Normal cache policy then passed that unchanged limit three times; fault tests still disable cache explicitly.
- Early fault-smoke attempts timed out or hit unsupported worker Fetch interception. The final loopback corruption fixture and detached-session handling passed all cases; those repairs are included in the green CI run.
- Webcam alignment, actual signing responsiveness, fast/slow/body-size variants, fluent language review, non-sign false accepts and real phone memory/thermal behavior still require human testing. No evidence justifies a public reliability claim.

## Reproduce and proceed

With dependencies and pinned assets installed, run the existing typecheck, test, lint, build and security scripts. For the measured comparison:

```powershell
node scripts/diagnostics/benchmark-tracking.mjs --chrome 'C:/Program Files/Google/Chrome/Application/chrome.exe' --baseline e63fffe64e6cc7136cf5191bd3beb07058c24200 --cpu-profile --out work/integration-benchmark.json
node scripts/baseline-gate.mjs docs/refinement/integration-2026-10-26/ci-pilot/candidate.jsonl docs/refinement/integration-2026-10-26/ci-pilot/development-candidate.jsonl
node scripts/verify-runtime.mjs --out out --profile full --require-evaluated
```

Follow [the manual-testing handoff](manual-testing.md) for the next authorized collection and device checks. Engineering work and review can proceed on this draft branch; public release remains blocked by the explicit human and device gates.
