# Recognition lifecycle follow-up — 14 October 2026

## Scope

Based on the exact aggregate draft #26 head, `81f715f9fe7634625ff2a56bba885a36db8c4823`. Original #21–#26, main, installed checkpoints, saved signs and dependency/audit policy remain unchanged. These are additional source fixes on a separate review branch; no merge or production deployment.

## Reproduced and repaired

1. **Overlapping cached-model inference after cancellation.** BSL/ISL/LSE checked cancellation before inference, but an already running native ORT call could outlive a camera/language reset. The next call could immediately reuse that same cached session. A per-session inference lane now waits for the previous native run and its tensor cleanup. Cancelled waiters remove themselves without allocating tensors, failed runs release the lane, and cancelled outputs cannot return predictions. Waiting uses the existing inference watchdog, not the download budget. Sessions for different models remain independent.
2. **Stale matching with a frozen frame clock.** Matching freshness depended only on the newest submitted camera timestamp. A result or queued snapshot could survive a long gap without newer frames. Personal/PSL matching now also measures elapsed monotonic time since submission, applying the existing 2.5-second age limit to both results and queued work. There is still only one active scan and one replaceable latest snapshot. Distance/confidence gates and model weights are unchanged.
3. **Failed negative trials reported as rejections.** The evaluator could report a zero false-accept rate even if its negative trials failed at runtime. It now reports completed trials and errors separately and withholds that cohort's rate when any trial failed. Observed false accepts remain counted, including those emitted before a failure. Nonempty recorded error lists also prevent a trial from being counted as correct when its status field was omitted.
4. **Browser smoke hydration race.** The workspace test mistook server-rendered language controls for hydrated React handlers and sometimes lost its first Start click. It now proves a language-selection state change before starting. Product UI behavior is unchanged.

## Validation

- Baseline: **278 tests / 35 files passed**. Fourteen new regression cases failed before the corresponding fixes; the final suite has **292 passing tests / 36 files**.
- Typecheck, ESLint, asset policy, secret/history audit, worker bundling and full Firebase static export: pass. Two rendered-page/security tests pass.
- Actual Chrome headless shell **151.0.7922.34**, production CSP and installed BSL/ISL/LSE ONNX checkpoints: a cancelled native call, an immediately requested fresh call, and a cached repeat complete for every model. Cancelled results are rejected and the two fresh outputs agree. These synthetic inputs test execution and recovery, not sign accuracy.
- Workspace browser checks pass: both transcript-switching paths, storage failures, phone viewport, qualified scores, footer navigation and RSL/Bangla entry/re-entry. All **3 delayed camera grants release their tracks**.
- The reusable real-model browser check is included in the Firebase build workflow before the unchanged dependency audit.
- All model bytes and persisted-data formats are unchanged. Browser probes are built only into temporary `out/` workers and removed afterwards.

Reproduce:

```sh
npm run typecheck
npm test
npm run lint
npm run build:firebase
npm run test:rendered
npm run repo:guard
npm run audit:secrets
node tests/workspace-browser-smoke.mjs /path/to/chrome
node tests/landmark-lifecycle-browser-smoke.mjs /path/to/chrome
node scripts/benchmarks/matching-isolation.mjs
```

Raw derived browser results: `followup-browser-2026-10-14.jsonl`.

## Fresh CPU measurements

Node **24.19.0**, real Node worker threads, 80 offered frames at 20Hz, synthetic similar personal examples, exact PR #21 baseline `84e239e9a9a9b1423831c7560af39f050f158f8b`, and the actual unchanged 775-reference PSL bundle. Raw results: `followup-performance-2026-10-14.jsonl`.

| Workload | PR #21 | Follow-up candidate |
| --- | ---: | ---: |
| 150 examples, p95 frame acknowledgement | 459.99 ms | 1.39 ms |
| 150 examples, acknowledged frames | 23/80 | 80/80 |
| 300 examples, p95 frame acknowledgement | 312.11 ms | 1.00 ms |
| 300 examples, acknowledged frames | 49/80 | 79/80 |
| PSL cold local decode + scan | 975.98 ms | 757.59 ms |
| PSL warm median, five scans | 387.11 ms | 129.53 ms |

These compare the cumulative isolated-worker implementation with #21, not the incremental speed of this lifecycle patch against #26. Scheduling and machine contention affect timings. Cold startup coalesced one candidate frame in the 300-example run, with a 133.05 ms maximum acknowledgement; do not interpret p95 as zero cold-start cost. PSL decisions match for this workload, and the independent full-DTW distance/ambiguity regression suite passes. These results establish neither phone FPS nor a real-world false-positive rate.

## Security review remains blocking

Fresh current-dependency audits: **9 findings, 8 high and 1 critical**; production-only: **3 findings, 2 high and 1 critical**. Auditing is unchanged and remains blocking.

PR #18 (`c7df0ffa9a31c45680716ffb6285c53ff71a198d`) and #19 (`f0015e7cc2fa630f567bf76ece661523d6f2b415`) have identical lockfiles, SHA-256 `a2d2e6665260398e8f7d198bd520302118af27f5e4e4e22a58e02aa72d7fe38e`. Re-auditing that exact dependency set reports **5 high development-only findings, zero production findings**. All seven original #19 policy tests pass, and its assessment returns `{ok: true, exceptionCount: 5}` on the current report. This is still a proposed exception requiring separate review, not a vulnerability fix or approval. Neither security branch nor its policy was imported into this follow-up.

## Accuracy and manual checks still outstanding

Re-summarizing the existing six-video ASL candidate evidence with the corrected reporter retains **2/6 correct**, **1/6 wrong accepted**, **3/6 abstentions**. The remaining **THANK YOU → PLEASE** acceptance is still a starter-rule failure. No new videos or negative controls were collected here, and no fresh accuracy improvement is claimed. Both negative-trial rates remain unmeasured.

The actual Tasks hand labels and ASL/BSL hand mapping are unchanged. A human-labelled physical left/right-hand check on two devices, broader independent fluent-signer-reviewed ASL/BSL footage, no-sign and unknown-sign trials, and phone/slow-connection camera lifecycle testing remain required. The diagnostic and exact protocol are in `recognition-accuracy-2026-10-14.md`. Software checks and synthetic browser execution do not resolve these release blockers.
