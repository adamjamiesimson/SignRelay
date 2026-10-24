# Sprint 4 readiness report, 22 October 2026

**Release: NO-GO.** Every software check passes. That is not a release decision. All five manual demo gates (MAN-1 to MAN-5) and all eight items in `docs/gitex/sprint-3/real-world-test-checklist.md` are still pending, and no unseen, live-camera, new-signer or no-sign false-acceptance measurement exists. Only the project owner changes this decision.

## Clean-worktree runs

Both runs: a fresh `git worktree` with its own `npm ci` and no build outputs, then `node scripts/readiness.mjs --build rehearsal,asl-demo --browser <chromium 1194>` on this container.

| | Baseline [`0637237`](baseline-0637237.md) | Final [`5511972`](final-5511972.md) |
| --- | --- | --- |
| typecheck, lint, worker build, repo guard, secret scan | pass | pass |
| unit tests | 871 passed, 1 skipped (84 files) | 887 passed, 1 skipped (85 files) |
| `audit:deps` | **fail** (2 vitest advisories) | pass |
| `npm audit --omit=dev` | pass | pass |
| rehearsal build, `gitex-rehearsal-smoke`, `transcript-a11y-smoke`, rendered export, runtime verifier | pass | pass (the a11y smoke now also checks D2, D5, D6, D7) |
| asl-demo build, `offline-vision`, `offline-demo-strict`, `lifecycle-stress`, `fault-injection` smokes, rendered export, runtime verifier | pass | pass |
| strict `audit:security` release gate | **fail** | pass |

`compareReports(baseline, final)`: unit-tests more tests (872 → 888); `dependency-gate` fixed; `strict-audit` fixed; no regression and no check left unrun.

## Other checks run on this branch

| Check | Result | Where |
| --- | --- | --- |
| `npm run demo:check` (deny-all proxy, strict) | pass: 0 non-loopback requests of 83 | local, asl-demo export |
| `offline-demo-strict-smoke --self-test` | pass: all 3 planted leaks caught | local |
| Full export without RSL: `workspace-browser-smoke`, `landmark-lifecycle-browser-smoke`, `lse-browser-smoke`, `bdsl-browser-smoke`, `test:rendered` | pass | local (every `build:firebase` step except the blocked RSL download) |
| `a11y-axe-smoke` with axe-core 4.10.3 (the CI version) | pass: 0 violations on `/`, `/languages`, `/models`, `/privacy`, `/about` and the live workspace | local, full export |
| Responsive probe: 9 pages and the workspace at 320 and 390 px | `/about` overflowed at 320 px before D7; none after | local; now part of transcript-a11y-smoke |
| `first-frame-stall.mjs`, `long-session.mjs` (30 s), `matching-isolation.mjs`, `personal-dtw.ts` | see [first-frame-stall.md](first-frame-stall.md) and the ledger, objectives 09–11 | local Node threads |
| Paired real-video pilot + baseline gate, worker `39a5f2c3` | pass: 11/11 trials identical to `ccce84c8` (5 correct, 0 wrong, 6 no match); gate ok, 0 changes | CI [run 39761389921](https://github.com/adamjamiesimson/SignRelay/actions/runs/39761389921) on `80a4395` |
| CI on #39, `80a4395` | Core CI, offline demo smokes, Firebase build (full export with RSL, workspace and axe smokes), strict audit and pilot: all green | GitHub Actions |
| CI on #39, `6555f92` and `5511972` | Core CI and offline demo smokes green. Firebase build and pilot **failed** in `install-rsl-model.mjs` with `ECONNRESET` from the RSL model host, before any build or test step (see unresolved item 8) | GitHub Actions |

## Not run, and why

| Check | Reason |
| --- | --- |
| Full `npm run build:firebase` and `rsl-browser-smoke` locally | This container's network policy refuses the RSL model host (`rndml-team-cv.obs.ru-moscow-1.hc.sbercloud.ru`, proxy `connect_rejected`). Both run in CI ("Firebase Static Build Check") |
| Real-video pilot locally | Needs the licensed clip download and the CI workflow; run in CI only, as established |
| Any physical camera, speaker, phone or demo-laptop check; native-signer or screen-reader review | Needs people and hardware. Nothing here substitutes for them |
| Sealed holdout | Deliberately not accessed |

## Unresolved issues

1. **Release gates pending.** MAN-1 to MAN-5 and checklist items 1–8 need an operator, a signer, a fluent ASL reviewer and real devices.
2. **Recognition false accepts remain** (synthetic): adjusting glasses, pushing hair aside, waving and lowering a hand from the mouth give HELLO or THANK YOU (`known-false-accept-risks.json`). The OFF experiments that address them need reviewed recordings before any change.
3. **Tail guard OFF.** The confirmed-sign tail guard needs the real-video comparison and an independent check that its rest is natural before it can be wired in behind a switch.
4. **Throughput.** Headless runs here analyse ~4 frames/s, below the 10 frames/s the demo needs. In 1 of the first 4 rehearsal runs the rapid sequence lost THANK YOU. Real-device throughput is unmeasured (checklist item 8).
5. **Auto speak cuts off a word still being spoken** when the next word is confirmed (it cancels before speaking). It is rare for single words. Not changed without an audible test and an owner decision on queueing.
6. **Minor failure path, not fixed.** If a personal example saves but the list then fails to reload, the message says the example could not be saved. This needs IndexedDB fault injection in the browser to test, so it was left; storage is still consistent.
7. **Dormant ASL-100 classifier** (`recognizeAsl100`, `public/models/asl100`, 640 KB) is unused by the app but cited in historical fingerprint records. Removal is an owner decision.
8. **CI dependency on an external host.** `build:firebase` downloads the 141 MB RSL model from one host on every run. On `6555f92` both the Firebase build and the pilot failed with `ECONNRESET` from that host before any test ran; the next push reran them.
