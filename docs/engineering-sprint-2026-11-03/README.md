# SignRelay engineering sprint — deterministic capture and stage attribution

**Base:** PR #50 head `d8cfefcd2953bac3a2de10722b1ca4f03cfca5a0` (`codex/engineering-sprint-2026-11-02`). Branch: `claude/charming-thompson-2aql9w`. Nothing was merged into main and nothing was deployed to Firebase.

**Summary.** I found and fixed one defect in the camera pipeline. Fingerspelling sometimes tracked the pixels of one camera frame under the previous frame's timestamp. In a matched A/B, mismatches fell from **11/316 (3.5 %) to 0/334** tracked frames. I also found that word mode stamps frames with the animation tick at which the tracking lane became free, not with the capture time. The capture-time fix for word mode is implemented and measured, but it is **off by default**: synthetic evidence shows it is not neutral for the hand-written ASL starter rules. A new fingerprint and replay toolchain names the first pipeline stage (schedule → observations → features → logits → output) at which two runs diverge. **No model, weight, threshold, decoder rule, vocabulary, feature extractor or saved-data format changed. Recognition accuracy has not been improved or re-measured on real signers.**

> **Follow-up validation (licensed recorded RGB, MediaPipe determinism, word-timing root cause):** [validation/README.md](validation/README.md). The capture fix showed **no measurable recognition change** against the exact PR #50 head on any exposed catalog. Run-to-run variability was traced to capture scheduling; tracking, inference and decoding are deterministic for identical input.

All measurements below are headless Chromium 153 on Linux x86_64 with CPU tracking and a synthetic fake camera. None of them is physical-webcam, GPU, mobile or signer evidence.

## 1. What changed in production code

| File | Change | Why |
|---|---|---|
| `lib/decoded-frame.ts` (new) | `OwnFrameSource` takes a WebCodecs `VideoFrame` so the pixels and their media timestamp come from one immutable object. It falls back permanently to the previous path if `VideoFrame` is missing, construction throws, the timestamp is not finite, or timestamps stall for 8 consecutive advancing callbacks. `MediaTrackingClock` maps the media clock onto a strictly increasing tracking clock and re-anchors if the media time runs backwards. | Measured defect (§2). |
| `lib/live-vision.ts` | The fingerspelling decoded-frame snapshot uses `OwnFrameSource`: it samples the lattice slot and timestamp from the frame's own time and draws that exact frame. Every `VideoFrame` is closed in `finally`. Word mode gets an opt-in `wordClockPolicy = "capture-time"`. The default stays `"pickup-tick"`, which is bit-identical to the base. Diagnostics added: `stats.repeated` and `frameClock`. | Fingerspelling defect fix. Word-mode change is held back (§3). |
| `components/translator-experience.tsx` | `?perf&captureClock=capture` enables the opt-in word-mode policy for diagnostics. Nothing else changed. | Lets the policy be measured on real recordings later without a new build. |
| `lib/pipeline-fingerprint.ts` (new) | 64-bit identifiers (two FNV-1a lanes, over Float32/Float64 bytes with numeric canonicalisation) for the capture schedule, landmark observations, model input, logits and decoded output. `firstDivergentStage()` compares two runs. | Problem 4: attribute run-to-run differences to a stage. |
| `lib/fingerspelling-capture.ts` | `diagnostics().fingerprints` (schedule, observations). `trace()` and `fromTrace()` support **local-only** replay. | Same. |
| `lib/fingerspelling-ctc-runtime.ts` | Post-inference decoding moved verbatim into the exported `interpretCtcLogits()`. Results carry `fingerprints` (features, logits, output). | One decoding path for the worker and offline replay. Pure refactor; no rule changed. |

The fingerprints are not secrets and not integrity hashes; model and asset integrity remain SHA-256. They are one-way and contain no landmark values. They are excluded from the research metrics export, which is an explicit allowlist (a test covers this). Research trials are held in memory only.

## 2. Capture and replay reliability

**Method.** `scripts/diagnostics/frame-identity-browser.mjs` encodes a 12-bit frame index (with an inverted check row) into a synthetic Y4M. Chrome's fake camera feeds it into the **real rehearsal export**. The production tracking worker is wrapped only to decode which source frame each tracked bitmap contains. Ground truth is a WebCodecs `VideoFrame` taken in the page: its decoded index and its own timestamp. The protocol was 3 runs × 8 s per cell, with baseline and candidate on the same machine. The word-mode candidate cells measure the capture-time policy, which is now opt-in. Raw data: [evidence/frame-identity-ab.json](evidence/frame-identity-ab.json).

| Cell | Tracked frames | Pixel/timestamp mismatches | Interval error p95 (per run) | Tracking rate |
|---|---:|---:|---|---:|
| Fingerspelling 30 fps — base | 316 | **11 (3.5 %)**, always −1 frame | 31.5 / 33.3 / 1.0 ms | 13.2 Hz |
| Fingerspelling 30 fps — fix | 334 | **0** | 0.5 / 1.3 / 2.6 ms | 13.9 Hz |
| Fingerspelling 15 fps — base | 314 | 0 | 5.2 / 0.7 / 0.3 ms | 13.1 Hz |
| Fingerspelling 15 fps — fix | 334 | 0 | 0.4 / 2.3 / 0.3 ms | 13.9 Hz |
| Words 30 fps — pick-up tick (default) | 216 | n/a (timestamps are tick times) | 32.8 / 14.7 / 14.6 ms | 9.0 Hz |
| Words 30 fps — capture-time (opt-in) | 209 | 0 | 1.9 / 0.6 / 1.9 ms | 8.7 Hz |
| Words 15 fps — pick-up tick (default) | 217 | n/a | 40.9 / 47.3 / 48.2 ms | 9.0 Hz |
| Words 15 fps — capture-time (opt-in) | 240 | 0 | 0.5 / 1.8 / 3.8 ms | 10.0 Hz |

Interval error compares consecutive tracked timestamps with the true source interval. Against true 66.7 ms intervals at 15 fps, the default word-mode clock is off by up to 48 ms at p95. The residual 0.3–3.8 ms with the fix is the fake camera's own pacing.

**Root cause.** `requestVideoFrameCallback` metadata describes the frame the compositor presented. By the time the callback runs, the element may already show a newer camera frame. [evidence/snapshot-fidelity.json](evidence/snapshot-fidelity.json) took a `VideoFrame` in every callback and compared its own timestamp with the metadata. They disagreed in **0–63 of ~180 callbacks per run** (0–36 %): in 1 of 8 runs without load and in all 8 runs with 10 ms/16 ms of main-thread load. Every snapshot method reads the element's current frame, so pairing it with callback metadata is unreliable by construction. Only a `VideoFrame` keeps the pixels and their timestamp together.

**Other findings**

- **Duplicates refuted.** I tested whether word mode tracks one camera frame twice under new timestamps, at 30, 15 and 5 fps. There were **0 duplicates**: the existing `video.currentTime` guard works in Chromium.
- **Throughput.** Word-mode CPU tracking ran at ~9 Hz here and fingerspelling at ~13–14 Hz. Both are below the previously desired rates, and both drop camera frames by design: the latest frame replaces older ones.
- **Main-thread cost.** The `VideoFrame` snapshot took 1.7–4.1 ms median and 2.3–6.0 ms p95 per callback. The old GPU-canvas snapshot took 1.8–2.1 ms median and 3.9–5.2 ms p95. That is no material change.
- **Lifecycle soak.** [evidence/capture-soak.json](evidence/capture-soak.json): 90 s with 4 mode switches, heap sampled after forced GC.
  - **0 unclosed-handle warnings** in candidate and baseline; the camera stayed active.
  - Fingerspelling heap: 5.66 → 6.03 MB (candidate) vs 5.64 → 6.04 MB (baseline).
  - Word-mode heap: 5.69 → 6.08 MB vs 5.68 → 6.06 MB.
  - This is not GPU, WASM-arena, mobile or total-RSS evidence.
- **Offline replay is deterministic.** A local trace replayed through `FingerspellingCapture` → features → installed ONNX (WASM) → `interpretCtcLogits` gives identical fingerprints at every stage across repeats. A 0.01 shift in one landmark is attributed to `observations` (tests/pipeline-fingerprint.test.ts). The serialisation lesson is now in the code: JSON turns `-0` into `0` and NaN into `null`, so fingerprints compare numeric identity and `fromTrace` restores NaN.

**Still non-deterministic or unqualified**

1. **Which frames are tracked.** The latest-frame policy drops camera frames depending on how long tracking takes. That is inherent to live capture. Fingerprints now show it as a `schedule` difference instead of an unexplained text difference.
2. **MediaPipe tracking for identical pixels.** This could not be qualified. The tracker detected no hand in any of three synthetic hand renderings, so a repeat would compare empty outputs. That run is retained as [inconclusive evidence](evidence/tracking-determinism-inconclusive.json), and the probe now exits 2 instead of reporting "identical". This needs licensed RGB recordings, for example in the existing CI RGB workflows.
3. **Cross-machine, GPU-delegate and browser-vendor floating-point behaviour.** Not tested.
4. **Fallback paths.** Safari and Firefox `VideoFrame(video)` timestamp semantics are untested. If they prove unusable, the code falls back to the previous behaviour.

## 3. Recognition comparison

**Fingerspelling.** Decoding is unchanged; the refactor is verbatim. The capture change only removes a one-frame timestamp error on about 3.5 % of 30 fps frames. Exactness, CER, false candidates and abstention were **not re-measured on recordings**: the licensed RGB catalogue and its frozen-cohort guards live in CI and local `work/`, neither of which is available here. **No accuracy claim is made.** The v3 features use observed time for velocity, so a one-frame time error distorts velocity at that frame; whether removing it changes text output is unmeasured.

**Word rules under the two clocks — an unsuccessful experiment, retained.** `tests/capture-clock-rules.test.ts` sends identical frames, in identical order, from one simulated camera/tracker schedule into the real recognition worker. Only the timestamps differ. Rules only; the model is mocked to abstain; synthetic kinematics. Settings: 2 frame rates × 4 tracking times × 2 rest lengths × 8 seeds. Data: [evidence/capture-clock-rules.json](evidence/capture-clock-rules.json).

| | Pick-up tick (default) | Capture time (opt-in) |
|---|---:|---:|
| Positive confirmations, all cells (max 768) | 603 | 594 |
| YES confirmations (max 128) | **51** | **43** |
| Runs whose confirmed words differ | — | 10 / 128 (corrected; first published as 11 by an arithmetic error) |
| Synthetic everyday-movement false confirmations (4 conditions × 33 cases) | 12, 10, 12, 9 | 12, 10, 12, 9 (identical) |

The differences occur only at tracking times of 80 ms or more and concentrate on YES. The starter rules evaluate fixed 650/1100/1700/2600 ms windows and were evidently tuned on the pick-up clock, which the rehearsal and throughput harnesses also reproduce: `RehearsalScript.next(now)` re-stamps held frames with the loop time. Truthful timing does not reduce false triggers and loses some synthetic YES. **Word mode therefore keeps its established clock by default.** Real-signer evidence is needed before changing it. Separately, these synthetic controls show the existing rules confirm THANK YOU or HELLO on 9–12 of 33 everyday-movement cases. That is pre-existing behaviour, and every candidate still requires the word pipeline's two-evidence confirmation.

**False recognition and OOV (Priority 1).** I made no rejection change. No independently reviewed negative, OOV or signer-disjoint data exists in this environment, and the previous sprint's 29 ordinary-action windows are exposed with unverified identities. The new fingerprints let a future false candidate be traced to the stage where it first differs from a correct run. Every fingerspelling candidate remains uncertain, and confirmation is still required before composition or speech.

## 4. Performance

| Measurement | Before | After |
|---|---|---|
| Fingerspelling tracked rate (3 × 8 s) | 13.1–13.2 Hz | 13.9 Hz |
| Snapshot cost per sampled callback, median / p95 | 1.8–2.1 / 3.9–5.2 ms | 1.7–4.1 / 2.3–6.0 ms |
| Heap after GC, 90 s soak with 4 mode switches | 5.64 → 6.04 MB | 5.66 → 6.03 MB |
| Personal DTW, idle model reuse, active cancellation | PR #50 | untouched (files unchanged; tests pass) |

The rate difference is within run-to-run noise and is not claimed as a speedup.

## 5. Tests

- **Unit (vitest):** baseline 1,038 passed, 0 failed, 2 skipped (108 files). Final: **1,058 passed, 0 failed, 3 skipped (111 files)**. The 3 skips are opt-in report writers; this sprint's writer was run separately and passed. New regression tests:
  - `decoded-frame-capture` (12 tests): own-timestamp pairing, repeats, fallbacks, stall disable, backwards clocks, mid-stream fallback in another clock domain, close-while-pending, and default word policy unchanged. Against the base `live-vision.ts`, 6 of the 12 fail. Only the fingerspelling pairing test reproduces the defect itself; the other five fail because they exercise the new API. The mid-stream test fails when its lattice-reset guard is removed.
  - `pipeline-fingerprint` (6 tests): ULP sensitivity, schedule/observation separation, trace round-trip, export exclusion, real-ONNX replay determinism.
  - `capture-clock-rules`: same-frames property and confirmation invariant under both clocks, plus the opt-in report writer.
- **Typecheck, lint, repo guard, rendered HTML, worker build:** all pass.
- **Browser smokes on the rehearsal export:** 11 suites passed on the pre-guard export: fingerspelling, gitex rehearsal, lifecycle stress, fault injection, user-feedback fault, transcript a11y, cooperative yield, offline vision, personal-vocabulary scale, onboarding (axe), a11y (axe). On the final-head export, fingerspelling, lifecycle stress, fault injection and gitex rehearsal were re-run and passed. Smokes that need the full multilingual build were not run locally.
- **Final-head probe:** fingerspelling at 30 fps showed 0/233 mismatches over 2 runs. Default word mode at 15 fps kept the base timing (interval error p95 47 ms), as intended.
- **Dependency gate:** `npm run audit:deps` exits 1, as expected (§6).
- **CI:** results are recorded on the draft PR. Details: [evidence/test-summary.json](evidence/test-summary.json).

## 6. Security status

- **npm audit:** unchanged at 16 moderate, all development-only, all from `minimatch <11.0.1` ([GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249)). Production has 0.
- **Upstream status on 2026-11-02:**
  - The advisory range covers every minimatch line below 11.0.1; there is no backport.
  - `eslint@10.14.0` requires `^10.2.6`; `@eslint/config-array@0.23.5` requires `^10.2.4`; `@typescript-eslint/typescript-estree@8.72.1` requires `^10.2.2`.
  - `eslint-plugin-import@2.32.0`, `eslint-plugin-react@7.37.5` and `eslint-plugin-jsx-a11y@6.10.2` require `^3.1.2`; `@eslint/eslintrc@3.3.7` requires `^3.1.5`.
  - No compatible combination exists.
  - npm's suggested fix is a forced major downgrade (eslint 4, eslint-config-next 12), which was not applied.
  - A blanket override to minimatch 11 would break the plugins' CommonJS callable API, so none was added.
- **PopSign:** not re-tested. This environment's outbound TLS goes through an intercepting agent proxy, so the publisher's real chain cannot be observed faithfully. The CI workflow remains authoritative. TLS verification, trust roots and mirrors were not touched.
- **Fake-camera diagnostics:** they use only generated test patterns. No recordings, landmarks or identifiers are published.

## 7. Language capability

No language asset, adapter, label file or availability label changed (`git diff` is empty for `public/`, `workers/` and the model adapters). The default unit suite's existing ONNX execution and label-alignment checks pass; see the test summary. The full multilingual `build:firebase`, which installs RSL from its verified source, was not run locally; the PR's Firebase build-check workflow runs it. The capability matrix from PR #50 stands unchanged: functional model loading is **not** independently validated signing accuracy for any language.

## 8–9. Pull request and preview

The draft PR is stacked on `codex/engineering-sprint-2026-11-02` (PR #50). The verified ancestry is linear: main ⊂ #43 ⊂ #44 ⊂ #45 ⊂ #46 ⊂ `claude/festive-dirac-pbwx2j`, which is #47's actual base, an intermediate branch without its own PR in the visible range. Then #47 ⊂ #48 ⊂ #49 ⊂ #50 ⊂ this branch.

Any Vercel preview is whatever the existing Git integration builds for this branch. As in PR #50, deployment protection (SSO) prevents a deployed-browser or model-completeness check from this environment. Protection was not changed, and no preview validation is claimed.

## 10. Rollback

Every change is additive or opt-in except the fingerspelling snapshot timestamp source.

- **Fingerspelling capture only:** revert `39a21e4` ("capture: stamp fingerspelling snapshots with the VideoFrame's own timestamp") on a new branch, then run `npm run build:worker` and the tests. `OwnFrameSource` also self-disables on unusable timestamps.
- **Whole sprint:** `git worktree add ../SignRelay-pr50 d8cfefcd2953bac3a2de10722b1ca4f03cfca5a0`, then rebuild.
- **User data:** no stored format or migration is involved, so stored examples and settings are unaffected.
- **Firebase:** untouched.

## 11. Blockers that need people, devices or licensed data (priority order)

1. **Tracking determinism and fingerspelling recognition impact.** Re-run the CI RGB catalogue with this branch. The fingerprints now report where runs diverge, and `tracking-determinism-browser.mjs` needs real hand frames.
2. **Independently reviewed negative, OOV and signer-disjoint recordings.** No rejection or intent change can be justified without them.
3. **Word-mode clock decision.** Real signers performing YES, THANK YOU and SORRY at the device's actual tracking rate, compared under `?perf&captureClock=capture` and the default.
4. **Physical webcams.**
   - Sensor-to-overlay latency.
   - Safari and Firefox `VideoFrame` timestamp semantics.
   - Mobile memory and thermal behaviour.
   - GPU delegate.
5. **Upstream minimatch backport or plugin migration** (dev only); PopSign publisher certificate reissuance.
6. **Deployed-preview access** for model-completeness verification.

## Reproduce

All scripts write to git-ignored `work/` by default. `$CHROME` below is your Chrome or Chromium executable.

Build the rehearsal export:

```sh
npm ci
npm run build:rehearsal
```

Camera schedule probe (modes: `words`, `words-capture`, `fingerspelling`):

```sh
node scripts/diagnostics/frame-identity-browser.mjs "$CHROME" fingerspelling 30 8 work/fs.json
```

Snapshot fidelity and per-call cost:

```sh
node scripts/diagnostics/snapshot-fidelity-browser.mjs "$CHROME" 30 6 work/fidelity.json
```

Lifecycle soak (90 s, 4 mode switches):

```sh
node scripts/diagnostics/capture-soak-browser.mjs "$CHROME" fingerspelling 90 work/soak.json 4
```

Tracking determinism (exits 2 when inconclusive):

```sh
node scripts/diagnostics/tracking-determinism-browser.mjs "$CHROME" work/td.json
```

Offline replay of local traces or captured tensors:

```sh
node scripts/diagnostics/run-fingerspelling-replay.mjs work/a.json [work/b.json] [--repeat 3]
```

Matched word-rule experiment:

```sh
RUN_CAPTURE_CLOCK_REPORT=1 SIGNRELAY_CAPTURE_CLOCK_REPORT=work/clock.json npx vitest run tests/capture-clock-rules.test.ts
```
