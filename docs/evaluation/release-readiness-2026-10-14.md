# Integrated readiness review — 14 October 2026

## Review scope and branch history

This integration branch preserves main at `75d97f22ee58f523bfa139a7f4094c09b15be248`, PR #21 at `84e239e9a9a9b1423831c7560af39f050f158f8b`, and PR #22 at `1eec439199fd3f229921a9f619fe982d291f9fa9`. The existing branches are unchanged. PR #22 is integrated by ancestry, not recreated as replacement work. No production deployment, main merge, dependency purchase or paid infrastructure change is authorized by this draft.

Focused follow-ups:

- [#23 — isolated personal/PSL matching](https://github.com/adamjamiesimson/SignRelay/pull/23), based on #21.
- [#24 — model loading/recovery](https://github.com/adamjamiesimson/SignRelay/pull/24), based on #23.
- [#25 — actual Tasks evaluation and ASL ambiguity veto](https://github.com/adamjamiesimson/SignRelay/pull/25), based on #24.

This aggregate integration is intended for review against main, including original #21/#22 and the focused follow-ups. Do not merge separate overlapping PRs by squash without checking the resulting ancestry/diff.

## Functional regressions repaired after reviewing #22

The original PR fixed the workspace dropdown but the welcome-screen language selector could still reuse an outgoing transcript after Back/Change language. Preservation now occurs in the shared selection function. Both paths archive under the original language, clear the new transcript only after a successful save, and keep the existing transcript/language if storage fails. Welcome-screen failures have visible accessible feedback. Resuming the same language retains its original session timestamp.

Delayed automatic-camera startup is guarded by generation. A camera permission grant arriving after leaving the shared workspace stops every granted track. RSL and Bangla retain their own explicit camera-start flow and never start the unused shared camera. The existing footer anchor, combining marks/joiners, all 300 Spanish label conversions and stored templates are preserved. Aborted IndexedDB writes now close/reject instead of leaving an operation pending.

The shared recognizer displays a visibly qualified match score out of 100, rather than presenting an uncalibrated percentage as translation accuracy. Confirmations retain optional provenance in transcripts; older records remain readable. Rule/template matches are distinguished where provenance is available. No confidence threshold changed.

## Final local validation

- Typecheck and ESLint: pass.
- Unit/regression suite: **278 tests across 35 files pass**, including real installed BSL/ISL/LSE ONNX execution in WASM.
- Full `npm run build:firebase`: pass; all installed model verifiers, four workers, Next static export and hash-based script policy generation pass.
- Rendered-page/security checks: **2 tests pass**. The final export has no local QA directory or baseline evaluation bundle.
- Actual headless-browser workspace smoke: pass, including dropdown and welcome transcript isolation, storage failure on both paths, three delayed permission grants with all three tracks stopped, RSL/Bangla entry/re-entry, footer navigation and a 390px viewport check.
- Repository asset policy and secret/history audit: pass, no findings. No raw evaluation videos or landmarks are committed.
- Core CI on the preceding focused branches: [#24 run](https://github.com/adamjamiesimson/SignRelay/actions/runs/38546744873) and [#25 run](https://github.com/adamjamiesimson/SignRelay/actions/runs/38549733303) passed. The aggregate PR still needs its exact-head CI result.

The browser workspace test controls worker confirmations and delays camera permission; it tests lifecycle/UI, not sign accuracy. The separate video evaluation runs the actual Tasks and production recognition worker.

## Final integrated performance

Command: `node scripts/benchmarks/matching-isolation.mjs`. Same exact PR #21 baseline, Node 24.19.0, real CPU worker threads, 80 offered frames at 20Hz, three similar examples per word. Raw figures are in `release-final-performance.jsonl`.

| Workload | PR #21 | Integrated candidate |
| --- | ---: | ---: |
| 150 examples, p95 frame acknowledgement | 263.16ms | 2.69ms |
| 300 examples, p95 frame acknowledgement | 253.44ms | 0.78ms |
| Acknowledged frames, 150 examples | 45/80 | 80/80 |
| Acknowledged frames, 300 examples | 51/80 | 80/80 |
| Actual 775 PSL references, cold local decode/scan | 626.51ms | 397.35ms |
| Actual 775 PSL references, warm median of 5 | 274.35ms | 82.27ms |

These are container CPU responsiveness measurements, not mobile FPS or accuracy estimates. Baseline frame coalescing can break continuous tracking and reduce its own matching work. Candidate cold worker/template startup reached 94.88ms; cold PSL JSON/decode work can still block its **own dedicated lane** for 163.51ms, while camera acknowledgements run separately. Local asset timings do not represent internet download speeds. The unchanged independent full-DTW tests retain all relevant distances and ambiguity vetoes; no false-positive claim is inferred from speed alone.

## Security work remains separate and blocks release

Reviewed [#18](https://github.com/adamjamiesimson/SignRelay/pull/18) and [#19](https://github.com/adamjamiesimson/SignRelay/pull/19) without changing either branch. Re-ran current full and production-only npm audits against their exact package/lockfiles, ran all seven #19 policy regression tests, and assessed the actual #19 report with its original policy code.

| Exact dependency set | Full npm audit | Production-only audit |
| --- | --- | --- |
| Main/integration, unchanged dependencies | 9 findings: 8 high, 1 critical | 3 findings: 2 high, 1 critical |
| #18 Next.js 16.4.0 dependency refresh | 5 high, 0 critical | 0 |
| #19 refresh plus proposed review gate | 5 high, 0 critical | 0 |

The five residual findings match the development-only `eslint-config-next → @next/eslint-plugin-next → fast-glob → micromatch → braces` chain. #19's original assessment returns `{ok: true, exceptionCount: 5}` on its actual report; that is a proposed exception, not a vulnerability fix or approval. Its seven tests reject changed findings/path/production exposure.

This branch keeps the original full `npm audit --audit-level=moderate` command, production/security headers and secret/history/export checks. The final `npm run audit:security` **fails as expected on the nine current findings**. The policy exception from #19 was not imported, and auditing was not silenced or downgraded. Do not use audit-fix force or deploy while this gate remains open.

## Recognition release blockers

The actual six-recording ASL pilot repeated twice: 2/6 correct trials in both baseline and candidate; wrong acceptances improve from 2/6 to 1/6 by abstaining on conflicting evidence. THANK YOU→PLEASE still occurs in a starter rule. This is not production-quality accuracy. The existing HELLO→PLEASE historical trace and the new failure must remain in development triage; reserve new holdouts for future tuning.

A physical left/right-hand truth test on two devices, broader ASL signers, independent BSL videos, no-sign and unknown-sign trials, phone memory/battery and throttled-connection camera recovery remain manual requirements. External BSL/Wikimedia media retrieval returned 403; missing trials are explicitly unmeasured. See `recognition-accuracy-2026-10-14.md` for the exact protocol and provenance limits.

No global hand swap, model replacement, saved-data migration, production merge or production deployment was made. All new code remains a draft for review.
