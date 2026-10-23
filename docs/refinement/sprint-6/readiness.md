# Sprint 6 readiness report, 23 October 2026

**Release: NO-GO.** Every software check below passes. That is not a release decision. MAN-1 to MAN-5 and the real-world checklist are still pending. No live-camera, new-signer, everyday-movement, screen-reader or device evidence exists. Only the project owner changes this decision.

**Candidate for manual testing:** the code commit **`cd86b2cca87f54c9c3a23bd8d1f95ceb7bcd7891`** (or any later commit on this branch that only adds documentation). Recognition worker `39a5f2c307242a5409bfabbf75a0ff18d4e5e6bd5365bd72966e9e8907b75ed5`, the bytes the CI pilot evaluated (11 development clips: 5 correct, 0 wrong, 6 no match; not an accuracy figure).

## Clean-worktree runs (this container)

`node scripts/readiness.mjs --build rehearsal,asl-demo --browser <chromium 1194>` in a fresh detached `git worktree` with its own `npm ci`.

| | Baseline [`c3b7fcf`](sprint6-baseline-c3b7fcf.md) (Sprint 5 head) | Final [`cd86b2c`](sprint6-final-cd86b2c.md) |
| --- | --- | --- |
| Checks | 22/22 pass | **23/23 pass** (adds `personal-vocabulary-scale-smoke`) |
| Unit tests | 909 passed, 2 skipped (911, 88 files) | 911 passed, 2 skipped (913, 88 files) |
| Strict `audit:security` release gate | pass | pass |
| Comparison | against Sprint 5 final `eb17163`: +2 tests (from `1ad683a`), no regression | against the baseline: +2 tests, one new check, **no regression** |
| Recognition worker built = committed | `39a5f2c3…` = `39a5f2c3…` | `39a5f2c3…` = `39a5f2c3…` |
| Worktree dirty after the run | no | no |

The 2 skips are opt-in report writers, not disabled tests. Both runs and a second unit-suite run gave identical counts: no intermittent results were seen.

## Other checks run in this sprint

| Check | Environment | Result |
| --- | --- | --- |
| `demo:serve` with port 3000 already taken | container | **before:** banner, then `EADDRINUSE` stack, other app answered at the URL; **after:** one-line refusal, exit 1, no banner |
| Insecure origin (`http://<LAN-style host>`) vs `127.0.0.1` / `localhost` | headless Chromium | insecure: CSP upgrades scripts to `https`, page inert, no camera API; loopback: works. Documented, CSP unchanged |
| Personal vocabulary at 30 / 150 / 300 examples | headless Chromium, real IndexedDB | exact counts load and reach the worker; at 300 the oldest word was unreachable **before**, reachable and removable **after**; no resurrection or duplication after reload |
| ASL search state: 320 / 390 / 1280 px, 390 px at 200 % text; axe-core 4.13.0 | headless Chromium | no overflow; 0 violations |
| `long-session.mjs`, 5 scenarios × 120 s | Node worker threads (**simulated**) | 0 faults, 0 dropped, 1 matcher worker, ack p95 ≤ 0.87 ms, no drift ([json](long-session-120s-c3b7fcf.json)) |

## CI

| Head | Core CI | Offline demo and rehearsal | Firebase build and strict audit | Real-video pilot | Private capture |
| --- | --- | --- | --- | --- | --- |
| `ed8f461` (#39) | pass | pass | pass | pass | — |
| `c3b7fcf` (#40) | pass | pass | pass | pass on attempt 2 (attempt 1: external TLS failure at the clip host, before any trial) | pass |
| This branch | see the PR | | | not triggered: no trigger path or worker byte changed | |

## Not run, and why

| Check | Reason |
| --- | --- |
| Full `build:firebase` and the multilingual browser smokes locally | The RSL model host is unreachable from this container. They run in CI's Firebase build |
| Real-video pilot | Its documented trigger (worker bytes, recognition sources, vision runtime, lockfile) did not apply; the worker is byte-identical to the evaluated `39a5f2c3` |
| Anything on a physical camera, speaker, laptop, phone, screen reader or signer | Needs people and hardware ([field-test-protocols.md](field-test-protocols.md)) |
| Sealed holdout | Deliberately not opened, fetched or evaluated |

## Outstanding risks and blockers (prioritised)

1. **P0, BLOCKED on people and hardware.** MAN-1 to MAN-5, new-signer recordings, independent fluent review and device measurements. Without them the release stays NO-GO.
2. **P1. Synthetic false accepts** for adjusting glasses, pushing hair aside, waving, shielding the eyes, blowing a kiss and lowering a hand from the mouth (HELLO, THANK YOU). MAN-2 measures the live behaviour; the OFF experiments need reviewed recordings first.
3. **P1. Throughput dependence.** Below about 10 analysed frames/s words are lost (YES first). The MAN-1 pre-flight blocks trials on a slow device; real-device throughput is unmeasured.
4. **P1. Phones are not reachable from the demo server** by design (loopback only; insecure LAN origins cannot run the app). Android needs USB port forwarding; iPhone needs an HTTPS copy, which is an owner decision.
5. **P2. External CI hosts** (pilot clip host TLS, RSL model host). Retry, cache and classification exist; a fresh outage still turns a check red for reasons outside the code.
6. **P2. `main` is unprotected** (issue #4); required checks are not enforced at merge time.
7. **P2. Carried over from Sprint 5:** auto-speak cancellation can cut a long phrase (owner decision after MAN-5); no cross-tab refresh of personal signs; unused `asl100` / `asl1000-tgcn` assets retained for fingerprint reproducibility.
8. **P3. CI maintenance:** GitHub warns that `actions/checkout@v4`, `setup-node@v4`, `cache@v4` and `upload-artifact@v4` target Node 20 and now run forced on Node 24. Not failing today.

## Shortest justified path to manual validation

1. Owner reviews and approves the integration plan; merges #39 → #40 → Sprint 6 in order with CI green at each step (or tests the candidate commit above without merging).
2. On the demo laptop: operator kit §2–§5 (`npm ci`, `demo:prepare`, `demo:check`, `demo:serve`, permission and ≥ 10 fps pre-flight).
3. Run MAN-1 (12 attempts), MAN-2 (movement list), MAN-4 (deny/allow, unplug), MAN-5 (speech) and MAN-3 (MAN-1 offline), logging with `npm run eval:log`. About 45 minutes with one signer.
4. Device part C on the laptop and two phones.
5. Owner reviews the logs. Any recognition change goes through a separate decision and fresh recordings, never these takes.
6. In parallel: consent, new-signer capture and independent fluent review (part D). These are required before any accuracy statement.

## Release decision

**NO-GO** for public release. The software candidate `cd86b2c` is **ready for manual testing** as a clearly labelled research prototype. It is not ready for any accuracy or reliability claim.
