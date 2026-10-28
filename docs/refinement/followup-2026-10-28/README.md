# Performance and recognition-reliability follow-up — 28 October 2026

Draft [PR #45](https://github.com/adamjamiesimson/SignRelay/pull/45), branch `claude/optimistic-clarke-mnreht`, is stacked on #44 (`codex/integration-release-candidate`). Baseline `fc95a6f361f19fd18bf28fd3e05998e447ce6758` was re-fetched on 28 October and had not moved. #44, its source branches, `main` and Firebase are untouched. Nothing was merged or deployed.

**Verdict unchanged:** supervised testing only on devices that pass the existing preflight. Public release **NO-GO**. No webcam session, physical device, new signer, fluent review or sealed-holdout access was involved.

**Recognition decisions are unchanged by construction.** The ASL-2000 logits are bit-identical, and the starter-rule output is exactly equivalent across 38,211 fixture prefixes. The pilot gate on the new worker reports zero changes across all 11 established trials.

## 1. ASL-2000 graph computation (measured, fixed)

**Cause.** #44's CPU profile attributed 87.6% of warm ASL samples to `applyGraphLayer`. The layer performs about 212 M multiply-accumulates per inference, which works out to ~10 ns per MAC on the integration laptop, or ~2.5 ns on this Xeon. The inner loop loaded and stored a `Float32Array` element for every multiply ([`lib/asl1000-runtime.ts`](../../../lib/asl1000-runtime.ts), `applyGraphLayer`).

**Fix.** Eight outputs now accumulate in locals. Each sum is still `fround(previous + value × weight)`: the int8 × float32 product is exact in double precision, and every rounding happens in the original source order. Weights, tensor/hand mapping, thresholds, cancellation and cooperative yielding are unchanged.

**Equivalence.** [`tests/asl1000-runtime.test.ts`](../../../tests/asl1000-runtime.test.ts) pins the SHA-256 of the raw float32 logits produced by `fc95a6f` on seven inputs (one synthetic plus six kinematic fixtures). The test passes on both the old and the new code. A deliberately non-exact variant (no `fround`) changed the hash, so the test detects rounding changes.

**Measurement** ([raw JSON](asl-compute-benchmark.json)):

- Tool: the existing `benchmark-tracking.mjs --phases-only`.
- Setup: five interleaved baseline/candidate runs with the same Chromium 153 headless, real committed weights, Linux x64 Xeon @ 2.10 GHz, 4 vCPU.
- Samples: one discarded warmup and five warm samples per run (25 per side).

| ASL-2000 warm computation | Run medians (ms) | Median of runs | Run p95 range |
| --- | --- | ---: | --- |
| Baseline `fc95a6f` | 506, 514, 534, 530, 526 | **526** | 533–606 |
| Candidate | 391, 371, 398, 432, 423 | **398** | 393–530 |

That is about −24% on this machine. Personal (6 templates) and PSL (775 references) were unchanged controls in the same runs. The integration laptop's 2,116 ms figure came from a different machine and is not re-measured here. No Windows paired run was possible.

Other stages named in the brief (capture, hand/auxiliary inference, transport, overlay age and analyzed fps) were not changed by this branch. #44's paired Windows numbers stand for them. The local offline-vision smoke on this machine reported tracking 90–106 / 146–161 ms (p50/p95) and 8.2–9.2 analyzed fps on a generated no-hand fake camera (delegate not recorded). That is not webcam evidence.

## 2. ASL-2000 model path: latency, not staleness

**Hypothesis tested.** Stale-result loss (the 2,500 ms freshness limit) was treated as a hypothesis, not an established cause.

[`tests/asl-model-latency-envelope.test.ts`](../../../tests/asl-model-latency-envelope.test.ts) drives the **production worker** with a mocked classifier at controlled latency on a controlled clock. The movement is THANK YOU reversed in time, which no starter rule names, followed by a still hold and then hands lowered. Results (Y = model word confirmed; 10 fps shown, 5 and 15 fps agree):

| Still hold before lowering | 150 ms | 400 | 600 | 900 | 1,200 | 1,500 | 2,100 | 2,900 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 500 ms | – | – | – | – | – | – | – | – |
| 1,000 ms | Y | – | – | – | – | – | – | – |
| 2,000 ms | Y | Y | Y | – | – | – | – | – |
| 3,000 ms | Y | Y | Y | Y | – | – | – | – |

**Mechanism** ([`workers/recognition.worker.ts`](../../../workers/recognition.worker.ts)):

- Model confirmation needs **two same-label results** (`shouldConfirm`, streak ≥ 2).
- The second inference starts only after the first result is consumed, so the two run sequentially.
- A result survives only while `analyzeSignMotion` stays `ready`, which requires the hand visible and still, at most 2,500 ms after settling ([`lib/sign-motion.ts`](../../../lib/sign-motion.ts)). Otherwise `invalidatePrediction()` advances `modelGeneration` and the in-flight result is discarded.
- So confirmation needs roughly 140 ms + 2 × latency + one frame ≤ min(still hold, 2,500 ms). Per-inference latency must be **under about 1.1 s**.

At #44's measured 2,116 ms median, the single result always arrives after the gate has closed, so **the model path cannot confirm any word on that laptop.** The separate `performance.now() − submittedAt > 2500` freshness check only matters above 2.5 s (p95 was 2,880 ms). It is not the binding constraint.

The two-evidence rule, the 2,500 ms settle window and the hands-visible requirement are safeguards the brief says to preserve. Changing them without reviewed evidence would trade false-accept protection for recall. **Faster computation is the only lever applied.** The test also asserts at most one inference in flight, no model result after the hands lower, and no repeats.

The six demo words are confirmed by starter rules, not by this path, so this does not explain the real-clip misses below.

## 3. Why the real-clip misses happen

**Source.** Opt-in traced dispatch [run 40656015750](https://github.com/adamjamiesimson/SignRelay/actions/runs/40656015750) on worker `b454deb00b6e` covered the same 11 frozen development clips, with no sealed holdout. Frame traces stayed on the runner under ignored `evaluation/raw`. Only the coordinate-free aggregates were kept: [historical](trace-report-historical.json) and [development](trace-report-development.json).

The report replays the worker's own bounded history and motion gate offline. For all six abstentions, the replayed motion reasons **match the worker's reported reasons frame for frame** (`replayed_motion_reasons_match_worker: true`). Accepted trials differ only because the worker clears its history after a confirmation, which is expected.

| Trial | Hand frames | Worker motion sequence (frames) | Stage where it stops |
| --- | ---: | --- | --- |
| THANK YOU `thankyou-…8031` | 4/31 | no-hand 11 · idle 4 · no-hand 16 | **Missing hand observations.** No 6-sample window. |
| THANK YOU `dev-thankyou-4a.7003` | 6/30 | no-hand 8 · idle 5 · moving 1 · no-hand 16 | **Hand lost mid-movement.** Gate never `ready`; no starter proposal. |
| THANK YOU `thankyou-…8033` | 15/37 | no-hand 11 · idle 5 · moving 10 · no-hand 11 | **Ambiguity veto** (PLEASE and THANK YOU both proposed once), then hand lost while moving. |
| YES `dev-yes-4a.8006` | 5/31 | no-hand 13 · idle 2 · no-hand 1 · idle 1 · no-hand 2 · idle 2 · no-hand 10 | **Fragmented history.** Longest run is 2 frames. |
| HELLO `hello-…8031` | 11/37 | no-hand 16 · idle 5 · moving 6 · no-hand 10 | **Insufficient independent confirmation.** One starter HELLO proposal; hand lost before a second. |
| HELLO `dev-hello-4a.8006` | 12/35 | no-hand 10 · idle 6 · moving 6 · no-hand 13 | **Hand lost mid-movement.** Gate never `ready`; no starter proposal. |

**What did not happen:**

- In none of the six did the motion gate release a sequence (`ready_prefixes: 0`). So the ASL-2000 model was **never asked**, and **no result expired**.
- Every trace ends with the tracked hand disappearing during or just after the stroke, followed by 10–16 frames with no hand.
- Stale-result loss is ruled out for these clips.

**Counterfactual (diagnostic only, not a production path).** The report also runs the shipped ASL-2000 graph and gate on each clip's longest tracked episode, ignoring the motion gate:

- The expected word was never top-1: DAWN 0.34, EVERYDAY 0.63, GRAPES 0.34, STRUCTURE 0.83.
- Two of these clear the model's own confidence and margin gate, so they would have been **wrong acceptances**.
- Loosening completion, sample-count or confirmation requirements for these clips would have traded abstentions for wrong words.

**Conclusion.** No production recognition change is justified:

- The misses are dominated by sparse hand detection (13–41% of frames in the abstaining clips) and by clips that end while the hand is still moving.
- The remaining causes are the ambiguity and two-evidence safeguards, working as designed.
- Whether hand detection fails on these clips because of motion blur, handshape or framing, or whether the PopSign takes are trimmed at stroke end, needs fluent review of the footage. It cannot be settled from counters.
- The next evidence needed is new reviewed recordings with a natural hold and lowering (see the [owner checklist](owner-checklist.md)). Nothing was tuned to these clip identities. No threshold, expectation, gate or OFF experiment changed.

## 4. Windows everyday-movement timeout

**What the case does.** `tests/asl-tail-guard.test.ts` › *never adds a word on everyday movements* replays 19 everyday patterns × 36 capture variations × 2 models × guarded/unguarded. That is 2,736 runs and **120,096 frames through the real worker**.

**Cause.** The case is CPU-bound in production recognizer code, not slowed by harness or scheduling and not hung. A CPU profile here attributed ~80% of samples to starter-rule analysis (`distance2`, `samplesFor`, `analyzeAslStarter`) plus 17% GC, and under 2% to the harness (`run`, `vary`).

`analyzeAslStarter` reads the same frames through 12 windows and recomputed each hand's measurements in every window. It also scanned for the nearest tracked body for every frame (O(n²)) even when unused, and allocated an array per landmark in `validHand`. On Linux the full-suite time matched the isolated time (39.6 s vs 37.3 s), so the Windows inflation (71 s isolated, >300 s in the full suite) is host contention on a 15 W laptop running many CPU-bound files in parallel.

**Fix** ([`lib/asl-starter-recognition.ts`](../../../lib/asl-starter-recognition.ts)). Window-independent per-hand measurements are computed once per analysis, keyed by frame *and* hand, because fixtures share one hand object across frames with different poses. The nearest-body scan runs only when the pose is lost. Landmark validation no longer allocates.

**Equivalence.** A differential run over 1,019 fixture sequences (every sign condition, variation, adversarial pattern, negative control, reversed and pose-dropout variant) and 38,211 analysis prefixes, 8,054 of them with a prediction, found **0 differences**. The committed tail-guard report test still matches byte for byte.

| | Before | After |
| --- | ---: | ---: |
| Case, isolated (Linux) | 37.3 s | 20.9 s |
| Case, inside the full suite (Linux) | 39.6 s | 23.0 s |
| Per worker frame | 0.31 ms | 0.17 ms |
| Full suite wall time (Linux, 4 vCPU) | 50.0 s | 32.7 s |

Coverage, assertions and the 300 s timeout are unchanged. **Windows full-suite verification is pending** (no Windows host was available). This also lowers production per-frame worker cost for moving hands.

## 5. Verification

### CI on code commit `ca7d8b6`

All CI ran on code commit `ca7d8b671a006d02357169479d39fc24c14627aa`. Every code change on this branch is in that commit; later commits change only documentation and evidence. Final-head results are listed in PR #45.

| Workflow | Result |
| --- | --- |
| [Core CI](https://github.com/adamjamiesimson/SignRelay/actions/runs/40656007900) | success |
| [Firebase static build and strict audit](https://github.com/adamjamiesimson/SignRelay/actions/runs/40656007831) (builds, never deploys) | success |
| [ASL video pilot](https://github.com/adamjamiesimson/SignRelay/actions/runs/40656008104) | success; exact-baseline gate `ok`, 0 changes, 0 explanations, worker `b454deb00b6e` |
| [ASL video pilot, traced dispatch](https://github.com/adamjamiesimson/SignRelay/actions/runs/40656015750) | success; same gate result, plus aggregate traces |
| [Offline demo and rehearsal](https://github.com/adamjamiesimson/SignRelay/actions/runs/40656007861) | success |
| [Analytics consent](https://github.com/adamjamiesimson/SignRelay/actions/runs/40656007843) | success |
| Private capture browser smoke | not triggered by these paths; dispatched on the final head (see PR) |

The established 11-trial result is preserved: **5 correct, 0 wrong accepted, 6 abstained, 0 errors.** All six abstentions are abstentions, not runtime errors. There were no expectation edits or gate waivers. The new worker is recorded in [`docs/evaluation/evaluated-runtimes.json`](../../evaluation/evaluated-runtimes.json); older entries and every historical report are unchanged. The per-trial CI artifact could not be downloaded from the authoring container (network policy). It is cited by ID and digest, not committed.

### Local checks

Linux x64 Xeon, 4 vCPU, Node 22.22.0, Chromium 153 headless.

| Check | Result |
| --- | --- |
| `npm test`, full suite | **951 passed, 0 failed, 2 skipped, 93 files**, 32.7 s. #44's head on the same machine: 950 passed, 1 failed (the dashboard provenance check, failing only because the worker bytes changed; regenerated), 2 skipped, 50.0 s. |
| `npm run typecheck`, `npm run lint`, `npm run repo:guard` | pass |
| `npm run build:worker` | committed bundle `recognition.worker.js` = `b454deb00b6e6aa4cba099e23bf96ed0a7ffd73058a2c725a6a16c610e3fa523`; the other committed bundles (`vision`, `bdsl`) are byte-identical to #44. `rsl` and `template-matching` are ignored build outputs. |
| `npm audit` (full and `--omit=dev`) | 0 vulnerabilities |
| `npm run audit:secrets` | 0 findings |
| `npm run build:firebase` (full static export) | **not completed locally**: the RSL model host is unreachable from this container (designed exit 75). The CI Firebase build passed. |
| `npm run build:asl-demo` with `verify-runtime` | pass; exported worker matches the committed worker |
| `demo:check` (strict offline, deny-all proxy), offline vision with CDNs blocked, lifecycle stress (12 restarts, 6 cancels, hidden tab, ended track), fault injection | pass |
| `build:rehearsal` with the rehearsal smoke (six signs, abstention, interruption, offline, speech, privacy), transcript and a11y, storage/speech faults, personal vocabulary at 30/150/300 examples | pass |
| Consent smoke (placeholder-ID export, as CI builds it) | pass |
| Windows full suite | **pending**: no Windows host |

Not run: any webcam, physical laptop, Android or iPhone session; MAN-1 to MAN-5; ten-minute device sessions; fluent review; new recordings; sealed holdouts. See the [owner checklist](owner-checklist.md).

## 6. Remaining limitations

- The integration laptop's ASL-2000 latency was not re-measured. The −24% figure comes from a different machine. If the laptop scales similarly (about 1.6 s), it stays above the ~1.1 s model-path envelope, so the model path would still not confirm there.
- The six demo words depend on starter rules. THANK YOU 0/3, YES 0/1 and HELLO 1/3 are unchanged, and their observed causes need new reviewed footage, not code changes.
- SORRY has no real recording. Real no-sign and OOV false acceptance remain **unmeasured**. The synthetic ordinary-motion false accepts documented earlier still stand.
- Generated no-hand tracking benchmarks and fake-camera fps do not establish webcam latency or signing accuracy.
