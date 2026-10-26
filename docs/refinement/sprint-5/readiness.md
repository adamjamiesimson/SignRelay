# Sprint 5 readiness report, 22 October 2026

**Release: NO-GO.** Every software check listed below passes. That is not a release decision. MAN-1 to MAN-5 and all eight items of `docs/gitex/sprint-3/real-world-test-checklist.md` are still pending: physical camera, everyday-movement false accepts, an offline demo laptop, camera recovery, real speakers, new-signer recordings, fluent ASL review and device performance. No unseen, live-camera, new-signer, screen-reader or no-sign false-acceptance evidence exists. Only the project owner changes this decision.

## Clean-worktree runs (this container)

`node scripts/readiness.mjs --build rehearsal,asl-demo --browser <chromium 1194>` in a fresh `git worktree` with its own `npm ci`.

| | Sprint 5 baseline [`ed8f461`](sprint5-baseline-ed8f461.md) | Final [`eb17163`](final-eb17163.md) |
| --- | --- | --- |
| Checks | 21/21 pass | 22/22 pass (adds `user-feedback-fault-smoke`) |
| Unit tests | 887 passed, 1 skipped (85 files) | 907 passed, 2 skipped (87 files); the extra skip is the opt-in low-throughput report |
| Strict `audit:security` release gate | pass | pass |
| Comparison | no change against Sprint 4's final run | more tests (888 → 909), one new check; no regression |

## CI on draft PR #40

| Head | Core CI | Offline demo and rehearsal | Firebase build and strict audit | Real-video pilot | Private capture |
| --- | --- | --- | --- | --- | --- |
| `f3a7ed3` | pass | pass | pass (RSL cache miss → one download, verified) | pass | pass |
| `4df0d48` | pass | **fail**: strict offline check flagged branded Chrome's own plain-HTTP update ping (E9, fixed in `1ad683a`) | pass | pass | pass |
| Final head | see the PR description | | | | |

The pilot ran on the unchanged worker `39a5f2c3`; the gate is expected to reproduce the 11 established trials exactly, and the PR description records the result.

## Other checks run locally

| Check | Result |
| --- | --- |
| `npm run demo:check` (deny-all proxy, strict) | pass: 0 non-loopback requests of 85 |
| Full export without RSL: `workspace-browser-smoke` (now with rapid language switching), `landmark-lifecycle-browser-smoke`, `lse-browser-smoke`, `bdsl-browser-smoke` | pass |
| `a11y-axe-smoke`, axe-core 4.10.3 | pass: 0 violations on 6 pages including the live workspace |
| Layout matrix: 35 configurations (widths, zoom, text size, long word) | 0 issues (4 before the fix) |
| `long-session.mjs`, 5 × 10 min | 0 faults; see [performance.md](performance.md) |
| `install-rsl-model.mjs` against the unreachable host | 4 attempts, exit 75, nothing installed |

## Not run, and why

| Check | Reason |
| --- | --- |
| Full `build:firebase` and `rsl-browser-smoke` locally | This container cannot reach the RSL model host. Both run in CI, which now caches the verified model |
| Real-video pilot locally | It needs the licensed clip download and the established workflow, so it runs in CI only |
| Physical camera, speakers, phones, the demo laptop, screen readers, signers | Need people and hardware |
| Sealed holdout (`popsign-reserved-holdout-2026-10-16.json`) | Deliberately not opened, fetched or evaluated |

## Prioritised remaining issues

1. **P0, BLOCKED on people and hardware.** Manual gates MAN-1 to MAN-5 and the real-world checklist (above). Without them the release stays NO-GO.
2. **P1. Synthetic false accepts** remain for adjusting glasses, pushing hair aside, waving and lowering a hand from the mouth (HELLO, THANK YOU). The OFF experiments need reviewed recordings first.
3. **P1. Throughput dependence.** Below about 10 analysed frames/s, two-evidence confirmation drops words, YES first ([low-throughput.md](low-throughput.md)). The MAN-1 pre-flight is the mitigation. Real-device throughput is unmeasured.
4. **P1. Tail guard OFF.** It needs the real-video comparison and independent review before it can be wired in behind a switch.
5. **P2. Auto-speak cancellation** can cut off a long phrase ([speech-policy.md](speech-policy.md)). The owner decides after MAN-5.
6. **P2. No cross-tab refresh** of the personal-sign list. Data stays consistent, but another open tab shows a stale list until reload.
7. **P2. Unused model assets** (`asl100`, `asl1000-tgcn`; 6.5 MB per export) are retained for fingerprint reproducibility. Owner decision.
8. **P2. Single external RSL host.** It is now cached and retried in CI; a first run after the manifest changes still depends on that host.
9. **P3. One unexplained 406 ms PSL acknowledgement** in a 10-minute Node run. It did not reproduce in paired 300 s runs of `main` or this branch.
