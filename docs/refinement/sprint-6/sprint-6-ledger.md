# Sprint 6 ledger: release-candidate preparation and demo readiness (23 October 2026)

Branch `claude/trusting-sagan-0uil0t`, created from the verified head of PR [#40](https://github.com/adamjamiesimson/SignRelay/pull/40), **`c3b7fcfca895f9aa3fdd2988bdd3cfe22321e67d`**, and stacked on it. Nothing was merged, deployed, published or force-pushed. The sealed holdout was not opened. Recognition thresholds, matching, ambiguity vetoes, two-evidence confirmation and every OFF experiment (tail guard, HELLO, THANK YOU, YES) are unchanged; the committed recognition worker is still **`39a5f2c3…`**.

Statuses: **DONE**, **PARTIAL** (gap stated), **BLOCKED** (needs people, devices or approval), **NOT NEEDED** (investigated; no change justified). Readiness, results and the release decision: [readiness.md](readiness.md). Integration: [integration-plan.md](integration-plan.md). Operator kit: [operator-kit.md](operator-kit.md). Field tests: [field-test-protocols.md](field-test-protocols.md).

**Environment.** Cloud container: Xeon x4, Node 22.22.0, npm 10.9.4, headless Chromium 1194 (Playwright build), synthetic fake camera. The RSL model host is not reachable from it. Every timing here is a Node-thread or headless-browser regression record, not device performance.

## Defects fixed (prioritised)

| # | Severity | Defect | Root cause | Fix and evidence |
| --- | --- | --- | --- | --- |
| F1 | **P1** (demo integrity) | `npm run demo:serve` announced *"SignRelay ASL demo build — http://127.0.0.1:3000/"*, the worker fingerprint and the evidence line, then crashed with a raw `EADDRINUSE` stack when port 3000 was taken. The other program (`npm run dev` defaults to 3000; an earlier `demo:serve` from an older checkout) kept answering at the advertised address, so trials could be run on the wrong build. | The banner was printed before the server tried to bind, and `serve-export.mjs` had no `error` handler. | `89ceb39`: the port is checked before the banner; a taken port exits 1 with the reason and the fix (stop the program, or `--port 3001`). `serve-export` reports a listen failure in one line. **Before:** reproduced with a dummy server on 3000 (banner + stack; `curl` returned the other app). **After:** one-line refusal, no banner, exit 1; free port unchanged (banner, serves the `asl-demo` manifest). Unit tests: held/free/invalid port; `serve-export` on a held port (fails on the old script). |
| F2 | **P2** (data management) | With more than 80 taught ASL words (300 examples = 100 words), the 20 oldest were not listed, and the page said *"Showing 80 of 100 words. Search to narrow the library."* although ASL had no search box. Those words could not be seen, selected, extended or removed from the list (only by retyping the exact word). | Since the initial commit the search existed only for the non-ASL built-in concept libraries; ASL lists were assumed short. | `cd86b2c`: the existing search control also appears for ASL when more than 80 words are taught (or while a search is active, so it can be cleared). New `personal-vocabulary-scale-smoke` **fails on `c3b7fcf`** ("no way to search for the rest") and passes now. Layout at 320/390/1280 px and 390 px with 200 % text: no overflow; axe-core 4.13.0: 0 violations in that state. |

Investigated and **not** a code defect:

| # | Finding | Conclusion |
| --- | --- | --- |
| N1 | Opening the app from a phone at `http://<laptop LAN address>:3000` | Reproduced with a non-loopback host name in Chromium: the page's own CSP `upgrade-insecure-requests` rewrites every script to `https://`, which fails, so the page never hydrates (dead buttons); the camera API is also absent on insecure origins. `127.0.0.1` and `localhost` work. The CSP is a production security control and stays. Documented instead: operator kit §4, §8 and §10 (Android USB port forwarding to `localhost`; HTTPS preview only with the owner's agreement). |
| N2 | `RecognitionSession` relaunches a *failed* worker on the next reset (tab change, pause, language switch) | Bounded (at most three attempts per user-visible event, then *failed* again), covered by `fault-injection-smoke`. Not changed. |
| N3 | Long-session benchmark shows `confirmed: {}` | Same in Sprint 5's 600 s record: the benchmark is a transport/load test, not a recognition test. |

## Phase 1: integration and baseline

| # | Objective | Status | Evidence |
| --- | --- | --- | --- |
| 01 | Full repository audit | DONE | `main` `0637237`; #39 `ed8f461` (draft, 6/6 checks green); #40 `c3b7fcf` (draft, 7/7 green, stacked on #39). Linear ancestry `main` → `ed8f461` → `c3b7fcf`. No other open PR targets the stack; #15/#17/#18/#19 are old drafts against an older `main`. Open issues #4 (protect `main`), #5, #6, #7, #32 reviewed; none blocks this sprint. No review threads on #40 |
| 02 | Safe integration assessment | DONE | `git merge-tree` of `main` with #39 and with #40: no conflicts; `main` + #40 = #40's tree (`cf736f9`). Every Sprint 4 line removed by Sprint 5 checked (deliberate refactors only). Plan: [integration-plan.md](integration-plan.md) |
| 03 | Reproducible candidate environment | DONE | Fresh detached `git worktree` per run with its own `npm ci` (412 packages, lockfile `2f8272b1…`). Node 22.22.0, npm 10.9.4, Next 16.4.2, React 19.2.6, MediaPipe Tasks 0.10.35, ONNX Runtime Web 1.23.2. Recognition worker `39a5f2c3…` built = committed; template-matching `73ba0127…`, RSL `be7a3589…`, Bangla `63cc19ab…`; ASL model `ebac604f…`, labels `4a4e1e6c…`; every export file hashed in `out/runtime-manifest.json` and checked by `verify:runtime` |
| 04 | Comprehensive baseline | DONE | [sprint6-baseline-c3b7fcf](sprint6-baseline-c3b7fcf.md): **22/22 pass**, 909 passed / 2 skipped (911, 88 files), strict gate PASS; identical to Sprint 5 (the +2 tests are `1ad683a`'s). The 2 skips are the opt-in report writers (`asl-experiments` full comparison, `asl-low-throughput` record). A second unit run gave the same counts: no intermittent result |
| 05 | CI reliability and independence | DONE (no change needed) | Pilot red on #40 twice with `CERTIFICATE_VERIFY_FAILED` from `signdata.cc.gatech.edu` before any trial; attempt 2 on the **same SHA** passed with gate `ok: true`, no changes, worker `39a5f2c3` — an external TLS outage, not code. TLS verification untouched. RSL download retry/cache/classification (Sprint 5 E1) verified in the workflows and `install-rsl-model` tests. Note: GitHub warns that `actions/*@v4` run forced on Node 24 — a maintenance item, not a failure |

## Phase 2: runtime reliability

| # | Objective | Status | Evidence |
| --- | --- | --- | --- |
| 06 | End-to-end recognition lifecycle | DONE (no new defect) | Reviewed camera → `VisionEngine` → `RecognitionSession` → worker → confirmation → transcript → speech, with every generation guard. Re-run: `gitex-rehearsal-smoke` (six words in order, abstention, interruption and recovery), `lifecycle-stress-smoke` (12 start/pause cycles, 6 rapid cancels, hidden tab, external track end, 3 re-entries), `fault-injection-smoke` |
| 07 | Multi-language regression | PARTIAL | ASL demo and rehearsal profiles fully re-run. Language routing, out-of-profile refusal, PSL, BSL/ISL/LSE loaders and the RSL/Bangla clip modes are covered by the unit suite (88 files) and by CI's Firebase build on `c3b7fcf` (full export: workspace, landmark-lifecycle across languages, RSL, Bangla, LSE, offline-vision and axe smokes). **Gap:** the full export cannot be built in this container (RSL host unreachable), so the multilingual browser smokes ran only in CI, not locally |
| 08 | Camera reliability | DONE (no new defect) | Covered: denied then retry, late grant releases tracks, cancel during start, track `ended`, stalled clock (8 s watchdog), hidden tab, re-entry. N1 above (insecure origin) is documented. No orphaned stream in any smoke (`live_tracks_after_cancel: 0`) |
| 09 | Worker lifecycle and recovery | DONE (no new defect) | `recognition-session` tests (bounded queue, hung worker, stale session, 2 restarts/min then manual) and `fault-injection-smoke` (crashes, failed construction) pass. N2 reviewed |
| 10 | Timing and false-confirmation protection | NOT NEEDED | Scheduling unchanged; no reproducible problem. Low-throughput behaviour stays as diagnosed in Sprint 5 (words lost below ~10 analysed fps); the MAN-1 pre-flight enforces the threshold |
| 11 | Personal-sign robustness | DONE | F2 fixed. New smoke: 30/150/300 examples load and reach the worker exactly (counts 30/150/300); removal at 300 leaves 297 stored and 297 sent, survives reload, nothing duplicated or resurrected. Existing concurrency and failure-path tests pass |
| 12 | Memory and performance endurance | DONE (simulated only) | `long-session.mjs`, 5 scenarios × 120 s on `c3b7fcf` ([long-session-120s-c3b7fcf.json](long-session-120s-c3b7fcf.json)): 0 faults, 0 dropped frames, exactly 1 matcher worker, ack p95 0.76–0.87 ms with no first-to-last drift, max 80 ms, worker heap in a GC band (7.9–26.7 MB); 3 language-switch/idle cycles. **Node threads, not a browser or device** |

## Phase 3: demo experience

| # | Objective | Status | Evidence |
| --- | --- | --- | --- |
| 13 | Complete user journey | DONE | Automated in headless Chromium: open, select ASL, start/stop, six confirmed words, edit (Enter and blur), empty edit removes, remove, Save & clear, copy, Speak/Stop with exactly-once speech, teach (record) and remove a personal sign, error recovery (`gitex-rehearsal-smoke`, `transcript-a11y-smoke`, `user-feedback-fault-smoke`, `personal-vocabulary-scale-smoke`, `fault-injection-smoke`) |
| 14 | Demo startup consistency | DONE | F1 fixed. `demo:serve` refuses a missing export, a missing manifest, the wrong profile, a failed runtime verification and now an occupied port, each with an instruction (unit tests). Camera permission and throughput are checked by the operator (kit §5); a browser cannot be pre-checked for camera permission from the terminal |
| 15 | Offline demo | DONE (software only) | `offline-demo-strict-smoke` behind a deny-all proxy on the clean `asl-demo` export: pass, 0 non-loopback page/worker requests; `offline-vision-smoke` and the rehearsal-hook absence check (`verify:runtime --profile asl-demo`) pass. MAN-3 on the laptop is pending |
| 16 | Graceful failure | DONE | Existing coverage re-run: denied/missing/busy camera, failed and corrupted tracking models, throwing storage, missing speech API, worker crashes. Microphone: **NOT NEEDED** (SignRelay never requests audio; `audio: false` everywhere). Insecure origin: N1 |
| 17 | Transcript and speech integrity | DONE (policy unchanged) | Order, single announcement, single speech, duplicate suppression, cancel on pause / Save & clear / language change, edits and timestamps (wall clock `Date.now()` in the worker) re-verified. Cancel-then-speak policy unchanged (Sprint 5 speech-policy, owner decision after MAN-5) |
| 18 | Accessibility and responsive | DONE (automated only) | `transcript-a11y-smoke` (keyboard, focus, live regions, 24 px targets, reduced motion, 35-configuration layout matrix) passes; the new ASL search state checked separately (no overflow, 0 axe violations). Not a screen-reader or assistive-technology user test; no certification claimed |

## Phase 4: real-world preparation

| # | Objective | Status | Evidence |
| --- | --- | --- | --- |
| 19 | Demo operator test kit | DONE | [operator-kit.md](operator-kit.md): setup, startup refusals, Chrome settings, permission check, expected states, stop/restart, troubleshooting, offline, phones |
| 20 | MAN-1 trial protocol | DONE (protocol only) | [field-test-protocols.md](field-test-protocols.md) part A: fixed 12-attempt counterbalanced order, mandatory ≥ 10 fps pre-flight, timing per attempt, `eval:log` keys, outcome definitions, no-retry rule |
| 21 | MAN-2 false-positive protocol | DONE (protocol only) | Part B: 16 movement groups from `known-false-accept-risks.json` and the adversarial inventory, 3 repetitions each, unknown signs, added words recorded as false accepts, no threshold changes |
| 22 | Device measurement instructions | DONE (protocol only) | Part C: laptop + two phones, cold/warm start, `?perf` line, interruptions, 10-minute run, memory, pass/fail P1–P5 (P5 proposed, owner to confirm), result storage. **No device values were produced** |
| 23 | Privacy-safe signer workflow | DONE (software verified; people BLOCKED) | Part D. Verified: private route excluded from public exports, CI capture smoke green on `c3b7fcf`, intake/review/live-log privacy rules covered by passing unit tests, results paths git-ignored and guarded. No participant recorded, no reviewer recruited |

## Phase 5: validation and handover

| # | Objective | Status | Evidence |
| --- | --- | --- | --- |
| 24 | Complete regression verification | DONE (with stated gaps) | Final clean-worktree readiness: see [readiness.md](readiness.md). The development-video comparison's trigger paths (worker bytes, recognition sources, vision runtime, lockfile) are untouched and the worker is byte-identical, so the pilot is not triggered; its last run on `c3b7fcf` reproduced all 11 trials. CI results for this branch are in the PR. Not run locally: the full multilingual export and RSL smoke (host unreachable) |
| 25 | Final handover | DONE | This ledger, [readiness.md](readiness.md), [integration-plan.md](integration-plan.md), [operator-kit.md](operator-kit.md), [field-test-protocols.md](field-test-protocols.md). Draft PR stacked on #40. Release **NO-GO** |
