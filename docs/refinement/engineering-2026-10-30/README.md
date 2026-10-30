# Engineering refinement sprint — 30 October 2026

Draft [PR #46](https://github.com/adamjamiesimson/SignRelay/pull/46), branch `claude/nifty-davinci-fgv665`, is stacked on [PR #45](https://github.com/adamjamiesimson/SignRelay/pull/45) (`e0b1f35`, itself stacked on #44). #44, #45, `main` and Firebase are untouched. Nothing was merged or deployed.

**Verdict unchanged:** supervised testing only, on devices that pass the existing preflight. Public release **NO-GO**. No webcam, physical device, signer, fluent review or sealed-holdout access was involved.

**One gate could not run.** The ASL video pilot (zero-new-wrong-acceptance gate) fails before evaluating anything, because the clip host's TLS chain stopped verifying on GitHub's runners. The same failure occurs on PR #45's previously passing head (see [§7](#7-blocked-the-asl-video-pilot)). This branch changes ASL-2000 scheduling, so its real-clip outcome is **unverified** until the pilot runs.

## How this sprint started

An earlier Codex session started this brief but stopped before pushing; nothing it did reached GitHub. Its transcript named five leads. Each was re-derived from the code and reproduced here before any change, and nothing was taken on trust:

| Codex lead | Outcome here |
| --- | --- |
| Tracking failures leave the overlay and recognition evidence stale | Reproduced (three failure shapes); fixed in §1 |
| Personal-template comparisons can stop once they cannot affect the result | Reproduced; fixed exactly in §2 |
| Time is lost waiting between cooperative inference slices; a MessageChannel yield helps | Reproduced; Codex's approach broke two Node tests, so §3 uses an environment-aware yield |
| RSL worker leaks tensors and caches a session after a contract mismatch | Reproduced; fixed in §4 |
| Windows CRLF checkout breaks byte-pinned tests | Reproduced (12 failures); fixed in §5 |
| (Codex's packed-weight experiment showed no gain and was dropped) | Not repeated |

The baseline itself had a defect, PR #45's golden-logit test, covered in §6.

## 1. Stale overlay and recognition evidence after a tracking failure

**Root cause.** Every tracking-worker failure goes through `LiveVision.fail()` ([`lib/live-vision.ts`](../../../lib/live-vision.ts)), which terminates the worker and starts CPU recovery. While recovering, `engine.busy` is true, so the frame loop draws nothing new until the replacement is ready. That takes seconds, with a 60 s startup limit. During that time:

- Hands already painted by the failed worker's early `hands` message stayed on screen, and the detection chips still said "hands".
- The recognition worker kept its history. An ASL-2000 or personal-template result submitted before the failure could be consumed after a short (< 2.5 s) recovery, against post-failure frames.
- A failure **during bitmap capture** resolves the frame as `null`, not as a rejection. The UI treated it as an ordinary dropped frame, so it could not tell anything had happened.

**Fix.**

- `LiveVision.onInterrupt` fires once per worker failure, before recovery starts. A deliberate stop doesn't trigger it.
- The workspace's `interruptTracking` ([`components/translator-experience.tsx`](../../../components/translator-experience.tsx)) clears the canvas, detection state, candidate and buffer, and resets the recognition worker. It runs on that hook and on any failed frame.
- Nothing is fabricated or carried across the gap.
- The tracking epoch is deliberately left alone, so a failed frame still counts toward the existing five-failure camera stop. Bumping it would have let a crashing worker respawn forever.

**Evidence.**

- [`tests/live-vision.test.ts`](../../../tests/live-vision.test.ts): failure during capture, after hands were painted (hook runs after the paint, before the rejection), on frame timeout, and no hook on deliberate stop. Three of the four fail on the previous code.
- [`tests/fault-injection-smoke.mjs`](../../../tests/fault-injection-smoke.mjs) crashes the tracking worker on the built export. It paints a marker pixel, then requires the overlay cleared and a recognition `reset` posted *in the same task as the crash*, so the replacement has no chance to repaint. Then it requires recovery to a new worker with the camera still active.
- **Negative control:** the previous code built and run under that smoke fails with "A tracking crash must clear the painted overlay immediately".

## 2. Personal-sign matching cost grows with saved examples

**Root cause.** The decision ([`lib/personalized-recognition.ts`](../../../lib/personalized-recognition.ts)) depends only on two things:

- the best word's exact distance (accept ≤ 0.5; confidence comes from it), and
- whether another word lies within 0.06 of it (ambiguity veto).

Yet every saved example inside a fixed 0.56 window got a full DTW in each of up to five time windows. In a realistic vocabulary, most other words sit somewhere between 0.1 and 0.5, all inside that window.

**Fix.** A distance at or above *best so far + 0.06* can neither become the best nor veto it, because the final best can only be lower. The cutoff now tightens to `min(0.56, best + 0.06 + 1e-9)` as matches are found. The 1e-9 tolerance keeps float rounding at the bound from pruning anything that matters. Every distance that can affect the decision is still computed exactly. Thresholds, windows and the veto are unchanged, and the sync and async matchers share the change.

**Equivalence.** [`tests/personal-bound-equivalence.test.ts`](../../../tests/personal-bound-equivalence.test.ts) compares both matchers with an **unpruned oracle**, exact DTW with no cutoff:

- **90 shuffled vocabularies** with several examples per word, both normalizations, and offsets clustered at the decision boundaries. At least 10 accepted and 10 rejected outcomes are required.
- **Margin edges:** rivals placed by bisection at 0.0595 (must veto) and 0.0605 (must accept), in both store orders.
- **Later windows:** a rival that appears only in a later window must still veto.

Mutating the margin to 0.03 or to 0.059 makes the test fail. The CI benchmark also asserts decision equality against its own full-matrix oracle on every run.

**Measurement** ([raw](personal-matching-benchmark.json)):

- Tool: `scripts/benchmarks/personal-dtw.ts`, synchronous and warm.
- Setup: interleaved baseline and candidate runs, each value the median of 5 repeats. Xeon @ 2.8 GHz, 4 vCPU, Node 22.22.

| Vocabulary shape (300 saved examples) | Baseline median | Candidate median |
| --- | ---: | ---: |
| Other words spread through the window, match stored first | 293 ms | **52 ms** |
| Same, match stored **last** (worst order) | 272 ms | **65 ms** |
| Near-ties within the 0.06 margin (must all be computed) | 297 ms | 244 ms |
| Other words far outside the window (already pruned) | 52 ms | 50 ms |

At 30 and 150 examples the spread case falls from 29 to 7 ms and from 137 to 28 ms; [raw JSON](personal-matching-benchmark.json) has all rows. Where nothing can be pruned, small cases did not improve: near-ties at 30 examples measured 30 → 37 ms and distant words at 150 measured 27 → 28 ms. Both are within run-to-run spread (the candidate's near-tie runs at 30 ranged 28–43 ms). No systematic slowdown is claimed or ruled out at that scale; the added work is one comparison per template. The browser scale smoke (30/150/300 stored examples) still passes ([§8](#8-verification)). Storage format and legacy compatibility are untouched: 208-feature, language-less and `trajectory-v3` examples all go through unchanged code paths, and the benchmark and equivalence tests cover legacy rows.

## 3. Cooperative inference spent ~25% of its time idle

**Root cause.** ASL-2000, the PSL scan and personal matching yield to queued messages with `setTimeout(0)`. Browsers clamp timers nested five or more deep to ≥ 4 ms, and each continuation runs inside the previous timer's task, so it nests:

- An ASL-2000 inference (49 graph layers, 12 ms slices) yields about 25 times, losing ~100 ms.
- The PSL scan uses 6 ms slices and loses proportionally more.

**Fix.** A shared [`lib/task-yield.ts`](../../../lib/task-yield.ts) picks the yield by environment:

- **Browsers:** a `MessageChannel` message. It's an ordinary task, scheduled fairly with worker input and timers, with no clamp.
- **Node:** `setImmediate`. Codex's `MessageChannel`-everywhere approach starved Node timers (zero `setInterval` callbacks during an inference) and failed two existing responsiveness and cancellation tests. Tests and diagnostic scripts run the libraries in Node.
- **Otherwise:** `setTimeout(0)`.

**Evidence.**

- The golden logit SHA-256 tests pass, so arithmetic is unchanged.
- The new [`tests/cooperative-yield-browser-smoke.mjs`](../../../tests/cooperative-yield-browser-smoke.mjs) (now in the demo CI workflow) runs the real model in a Chromium module worker. During inference it requires page messages and worker timers to run (92 and 12 in one inference), a page message and a worker timer to each abort it, and identical output afterwards.
- It also requires a page message to abort personal matching.
- **Negative control:** a microtask "yield" fails the smoke (0 page messages handled).

**Measurement** ([raw](yield-ab-benchmark.json)): same probe, browser and host. Only the yield primitive differs, and runs are interleaved.

| Warm worker computation | `setTimeout(0)` (previous) | Candidate |
| --- | ---: | ---: |
| ASL-2000, median of 7 run medians | 570 ms | **419 ms** (−26%) |
| PSL 775-reference scan, median of 3 | 192 ms | **107 ms** (−44%) |

**Relation to the latency envelope.** PR #45 showed a model-only ASL word can be confirmed only when one inference takes under ~1.1 s. PR #44 measured a 2,116 ms median on the Windows integration laptop. The yield saving there is unmeasured. It is a fixed ~4 ms × ~25 yields per inference, so it should be similar in absolute terms (~0.1 s). That is a gain, not enough on its own to bring that laptop under the envelope. **Recognition safeguards, gates and thresholds are unchanged.**

## 4. RSL worker resources

**Root cause** ([`workers/rsl.worker.ts`](../../../workers/rsl.worker.ts)). The repository convention, enforced for BSL/ISL/LSE by `tests/onnx-tensor-disposal.test.ts` and followed by the BdSL worker, is to dispose tensors and release a session that fails its contract check. RSL was the outlier:

- **Mismatched session kept.** `session ??=` kept a session that failed the input/output contract check. That held the model in WASM heap memory, which garbage collection never frees, and a later request would run it.
- **Tensors never disposed.** The 19 MB input tensor and the output tensors were never disposed.
- **Unknown messages treated as recognition.** Any message that wasn't `load` ran a recognition.

**Fix.** RSL now matches the BdSL pattern. Output validation is deliberately unchanged: `decodeRslOutput` still checks the 1,001 probabilities. A stricter shape check was considered and rejected, because CI's fake camera may never reach `session.run` to verify it.

**Evidence.** [`tests/rsl-worker.test.ts`](../../../tests/rsl-worker.test.ts) (mocked onnxruntime-web) fails three of three on the previous worker. The CI Firebase build, which loads the real Slovo model in Chrome, passes.

**Other adapters.** BSL, ISL, LSE and BdSL were audited for the same issues and already disposed tensors and released mismatched sessions; PSL already had cancellation coverage. The RSL and BdSL components already time out and terminate their workers. Language identities, vocabulary counts, licences and recognition modes are unchanged; `tests/personalized-recognition.test.ts` still pins the registry. PSL's tighter-cutoff variant was **not** applied: PSL returns a `margin` field that would change when the true rival lies beyond best + 0.06, and performance-only changes must keep outputs identical.

## 5. Windows checkouts broke byte-pinned evidence

**Root cause.** With `core.autocrlf=true` (the Windows default), every text file is checked out with CRLF:

- The committed recognition worker then hashes differently from the evaluated-runtime registry.
- 12 tests that compare workflows, manifests, the cohort lock, confusion matrices and the dashboard byte for byte fail. These are the file-format failures in Codex's Windows baseline (939/12/2).

**Fix.** [`.gitattributes`](../../../.gitattributes) sets `* text=auto eol=lf` and declares the binary asset types. The index was already all LF, so nothing is renormalized.

**Evidence.**

- A clone made here with `core.autocrlf=true` failed 12 tests before the rule and none after.
- Its worker bytes are identical to the committed bundle.
- One residual failure in that clone (`fast-glob-shim`) comes from its symlinked `node_modules`, not line endings.
- Existing Windows clones must refresh their working tree once (see the [owner checklist](owner-checklist.md)).

## 6. Baseline defect: golden-logit test timeout

PR #45's `keeps every float32 logit bit-identical…` runs seven full inferences, about 6 s in Node here, with no explicit time budget. It failed in isolation and in the full suite on this host (baseline full suite: **950 passed, 1 failed, 2 skipped**) and on Codex's Windows run. The test now has a 120 s budget, like the repository's other heavy numerical tests. The hashes, inputs and assertion are unchanged.

## 7. Blocked: the ASL video pilot

Pilot runs [41017695427](https://github.com/adamjamiesimson/SignRelay/actions/runs/41017695427), [41017884190](https://github.com/adamjamiesimson/SignRelay/actions/runs/41017884190) and [41018187214](https://github.com/adamjamiesimson/SignRelay/actions/runs/41018187214) on this branch all stop in `training/fetch_evaluation_clips.py` with:

```
urllib.error.URLError: <urlopen error [SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed: unable to get local issuer certificate>
```

That happens before any clip is evaluated. **Control:** re-dispatching the pilot on PR #45's unchanged head `e0b1f35`, which passed on 28 October, fails identically ([41018226895](https://github.com/adamjamiesimson/SignRelay/actions/runs/41018226895)). So the cause is the clip host `signdata.cc.gatech.edu`, whose certificate chain no longer verifies against the runner's CA store, not this branch. Its chain could not be inspected from this container, whose proxy refuses the host.

TLS verification was **not** weakened, and no clip was cached or redistributed. **Therefore:**

- No recognition outcome counts are reported for worker `afd4bf13f6e5`.
- [`docs/evaluation/evaluated-runtimes.json`](../../evaluation/evaluated-runtimes.json) has no entry for it.
- The dashboard is marked stale for it.
- `verify-runtime` reports "real_video_evidence: none recorded".

The last measured result remains PR #45's worker `b454deb00b6e`: **5 correct, 0 wrong accepted, 6 abstained, 0 errors** on 11 development clips.

**Why it matters for this branch.** The tracking invalidation, personal pruning (no templates in the pilot) and RSL changes cannot affect pilot outcomes. Faster ASL-2000 scheduling can: a result arriving sooner may land inside the motion gate where it previously expired. The two-evidence rule and all gates are unchanged. The deterministic synthetic gates through the real worker still pass, including the tail-guard everyday-movement case (120,096 frames, zero added words), the confusion matrices and the adversarial inventory. They are not real-clip evidence.

**Re-run** the pilot (`workflow_dispatch` on this branch) once the host verifies again, and record the result before relying on this worker.

## 8. Verification

### Local checks

Linux x64 Xeon @ 2.8 GHz, 4 vCPU, Node 22.22.0, Chromium (Playwright 1243) headless.

| Check | Result |
| --- | --- |
| `npm test`, full suite | **961 passed, 0 failed, 2 skipped, 95 files**, 45.8 s. Baseline `e0b1f35` on the same machine: 950 passed, **1 failed** (golden-logit timeout, §6), 2 skipped, 93 files. |
| `npm run typecheck`, `npm run lint`, `npm run repo:guard` | pass |
| `npm audit` (full and `--omit=dev`), `npm run audit:secrets`, `npm run test:rendered` | 0 vulnerabilities, 0 findings, pass |
| `npm run build:worker` | committed `recognition.worker.js` = `afd4bf13f6e50fe44b730a07af25618f037bbca319c2001cc210807b560296a2`. The `vision` and `bdsl` bundles are unchanged. |
| `build:asl-demo` with `verify-runtime --profile asl-demo` | pass; exported worker matches the committed worker; "real_video_evidence: none recorded" (§7) |
| Demo smokes: `demo:check` (strict offline, deny-all proxy), leak-detector self-test, offline vision with CDNs blocked, lifecycle stress (heap 5 → 5 MB, no errors), fault injection including the new tracking crash | pass |
| `build:rehearsal` with `verify-runtime --profile rehearsal`; six-sign rehearsal (abstains on three non-sign movements, confirms all six, recovers from interruption), transcript and a11y, storage/speech faults, personal vocabulary at 30/150/300 examples | pass |
| `tests/cooperative-yield-browser-smoke.mjs` (new) | pass |
| CRLF clone (`core.autocrlf=true`) full suite | before `.gitattributes`: 12 failed; after: 0 line-ending failures (§5) |
| `npm run build:firebase` | not run locally: the RSL model host is unreachable from this container (designed exit 75), as in PR #45. CI's Firebase build passed (below). |

**Ten-minute sessions** ([steady](long-session-300-personal-600s.json), [cycling](long-session-300-personal-cycling-600s.json)). These use `scripts/benchmarks/long-session.mjs`: the real recognition-worker logic on Node worker threads at a 20 Hz offered camera cadence. That is **not a browser, camera or phone measurement.**

| 600 s scenario | Frames offered / acknowledged / dropped | Faults | Ack latency p50 / p95 / max | Worker heap | Process RSS start → 5 min → 10 min |
| --- | --- | --- | --- | --- | --- |
| 300 personal examples | 12,001 / 12,001 / 0 | 0 | 0.57 / 0.87 / 53 ms | 21–34 MB sawtooth, returns to ~21 MB after each collection | 185 → 254 → 264 MB |
| 300 examples, language switch and idle every 30 s (19 cycles) | 8,182 / 8,182 / 0 | 0 | 0.57 / 0.89 / 60 ms (first frame) | 18.5–25.8 MB | 188 → 358 → 376 MB |

Process RSS covers the whole Node process (main thread, packing buffers, every worker thread). Its growth flattens in the second half. It is not new: Sprint 5 recorded the same cycling scenario at 263 → 422 MB ([sprint-5](../sprint-5/long-session-600s.json)), though that is not a matched comparison. A browser or phone ten-minute memory check remains an owner item.

### CI on `695655c`

All code is in `695655c`; the later commits are documentation and evidence.

| Workflow | Result |
| --- | --- |
| [Core CI](https://github.com/adamjamiesimson/SignRelay/actions/runs/41018187122) (typecheck, test, lint, worker, repo guard) | success |
| [Firebase static build and strict audit](https://github.com/adamjamiesimson/SignRelay/actions/runs/41018187213) (builds, never deploys). Covers the real Russian model worker, Bangla and Spanish flows, cancelled model runs and cached session reuse in Chrome, and axe | success, plus the strict dependency audit |
| [Offline demo and rehearsal](https://github.com/adamjamiesimson/SignRelay/actions/runs/41018187185), including the new cooperative-yield smoke and the tracking-crash fault check | success |
| [Analytics consent](https://github.com/adamjamiesimson/SignRelay/actions/runs/41018187139) | success |
| [ASL video pilot](https://github.com/adamjamiesimson/SignRelay/actions/runs/41018187214) | **failure before evaluation**: clip host TLS (§7), same on PR #45's head |

### Recognition outcomes

| Evidence | Correct | Wrong accepted | Abstained | Errors |
| --- | ---: | ---: | ---: | ---: |
| Real development clips, worker `afd4bf13f6e5` (this branch) | — | — | — | not run (§7) |
| Real development clips, worker `b454deb00b6e` (PR #45, last measured) | 5 | **0** | 6 | 0 |
| Synthetic rehearsal, six signs plus three non-sign movements (this branch) | 6/6 | **0** | 3/3 | 0 |

The synthetic row is kinematic fixtures, not signing accuracy.

## 9. Remaining limitations and unverified hypotheses

- **Pilot gate blocked** (§7). This is the most important open item.
- **No device evidence.** Every timing above is a Linux Xeon container in headless Chromium or Node. The Windows integration laptop and phones were not measured, so yield savings there are estimated, not measured.
- **Real-clip misses unchanged.** PR #45's analysis stands. The THANK YOU, YES and HELLO misses are dominated by sparse hand detection and clips that end mid-stroke. Nothing in this sprint changes recognition rules, and nothing should until reviewed recordings with a natural hold and lowering exist.
- **Live webcam behaviour of §1 unobserved.** The invalidation is proven on the built export with an injected crash, not observed on a live webcam.
- **Ten-minute run is simulated.** The long-session run is a Node worker-thread simulation, not a browser or phone session.
- **Real no-sign and OOV false acceptance still unmeasured.** SORRY still has no real recording.
- **Windows full suite not run.** Expected to pass after a working-tree refresh (§5).
