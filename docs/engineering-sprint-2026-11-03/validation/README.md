# PR #51 recorded-recognition validation

**Question:** does PR #51's corrected fingerspelling capture (pixels stamped with their own `VideoFrame` timestamp) help or harm recognition on licensed recorded RGB, and where does run-to-run variability actually come from?

**Answer**
- **No measurable change in recognition either way.** On every exposed recorded-RGB catalog, baseline (exact PR #50 head `d8cfefc`) and candidate (PR #51) are statistically indistinguishable. False candidates on ordinary actions are identical, and there were no technical failures.
- **Variability comes from capture scheduling, not inference.** MediaPipe CPU tracking, feature extraction, ONNX inference and decoding are bit-for-bit deterministic for identical input.
- **The source of the scheduling variation is identified.** The CI tracker needs about 72 ms per frame, longer than the 66.7 ms slot of the 15 Hz capture lattice, so which frames are tracked depends on timing. A single skipped frame changes MediaPipe's tracking state for dozens of later frames.

**Decisions**
- The PR #51 capture fix is **retained**. It is correct by construction (§4), and no harm was detected.
- No model, weight, threshold, decoder or rule was changed.
- Word-mode timing stays at its established default.

All recordings are **exposed regression recordings** (FSboard CC BY 4.0, frozen Wikimedia Commons action windows) run through Chrome's fake camera on GitHub-hosted CPUs. None of this is a fresh final cohort, a physical webcam or independent signer evidence.

## 1. Baseline versus candidate on recorded RGB

**Protocol.** [Run 41421199003](https://github.com/adamjamiesimson/SignRelay/actions/runs/41421199003) used the established same-runner driver (`sprint-paired-replay.py`):
- Each predetermined case alternated between the two implementations on one runner, with the order reversed on even repeats.
- Inputs were byte-identical Y4M files from checksum-verified sources.
- The workflow asserted an identical lockfile and an identical tracker worker, plus the model SHA-256.
- No landmark injection was used.

The summary was produced inside CI ([run 41424905979](https://github.com/adamjamiesimson/SignRelay/actions/runs/41424905979)), because artifact storage is not reachable from the engineering environment. Ledger SHA-256s are recorded in [evidence/recorded-rgb-summary.json](evidence/recorded-rgb-summary.json).

| Catalog (captures per implementation) | Metric | PR #50 baseline | PR #51 candidate |
|---|---|---:|---:|
| 10 positive × 3 repeats (30) | exact | 9/30 | 11/30 |
| | CER (edits / chars) | 70/384 = 18.23 % | 70/384 = 18.23 % |
| | candidates / abstentions / technical failures | 30 / 0 / 0 | 30 / 0 / 0 |
| | same text in all 3 repeats | 4/10 | 4/10 |
| | Finish → candidate, median / p95 | 92.5 / 154.3 ms | 93.6 / 145.6 ms |
| 29 ordinary-action windows × 2 (58) | false candidates | 7/58 | 7/58 |
| | abstentions (quality / model) | 51 (46 / 5) | 51 (46 / 5) |
| | same outcome in both repeats | 25/29 | 25/29 |
| 5 Q/J/Z + returned-Left, original × 6 (30)† | exact / edits / chars | 14/30 / 34/396 | 14/30 / 31/396 |
| 5 Q/J/Z + returned-Left, mirrored × 6 (30)† | exact / edits / chars | 13/30 / 25/396 | 11/30 / 26/396 |
| All catalogs | technical failures | 0 | 0 |

† Repeats 1–2 come from the main run; repeats 3–6 come from the pre-registered follow-up ([run 41425230204](https://github.com/adamjamiesimson/SignRelay/actions/runs/41425230204)). Repeats 1–2 alone: original 5/10 vs 5/10 exact, 10 vs 9 edits; mirrored 5/10 vs 3/10 exact, 5 vs 8 edits.

Median observed capture rate was 13.5 Hz (positive) and 15.0 Hz (others) for both implementations.

**Paired captures (same case, same repeat), candidate edits versus baseline edits**

| Catalog | Candidate fewer edits | Candidate more edits | Same edits |
|---|---:|---:|---:|
| Positive | 5 | 4 | 21 |
| Rare original (6 repeats) | 5 | 3 | 22 |
| Rare mirrored (6 repeats) | 4 | 6 | 20 |
| **Total** | **14** | **13** | **85** |

A two-sided sign test gives p ≈ 1.0 overall, and p ≈ 0.75 for rare mirrored. The first two mirrored repeats alone were 0 vs 3 (p = 0.25). The follow-up repeats alone reversed that, at 4 vs 3.

**Identical captured tensors between implementations: 0 of 97 compared pairs** (30 positive, 7 negative windows that reached capture, 60 rare). As in PR #50, the two implementations never captured the same tensor for the same case. Recognition differences between them therefore cannot be attributed to the capture change itself (§2).

**Where the candidate's own repeats diverge.** The candidate records stage fingerprints, so its repeats can be traced. For every positive and rare case, the first divergent stage across repeats is **schedule**: different decoded frames were tracked. The baseline has no fingerprints, so it shows only differing tensors ("features"). For ordinary-action windows, 23 of 29 are quality abstentions without capture telemetry ("unavailable"); the other 6 diverge at schedule.

## 2. MediaPipe tracking determinism with real hands

**Method.** [Run 41421547592](https://github.com/adamjamiesimson/SignRelay/actions/runs/41421547592) used `tracking-determinism-prepare.py` with `run-tracking-determinism.mjs`.
- **Frames:** 13 unique licensed clips (the 10 positive cases plus the 3 Q/J/Z cases not already among them). Every displayed frame was decoded losslessly, and the frames never left the runner.
- **Tracking:** frames went to the **production** CPU tracking worker in lockstep, with no camera and no wall-clock drops, scaled exactly as `LiveVision` does.
- **Decoding:** each schedule was decoded with the production capture → v3 features → installed ONNX → `interpretCtcLogits` path.
- **Coverage:** every clip had detected hands, so 13/13 clips are conclusive. Undetected-hand runs would not count as evidence.

| Controlled change | Frames compared | Landmark result | First divergent stage | Recognition impact |
|---|---:|---|---|---|
| Identical pixels and timestamps, fresh worker | 1,042 | **1,042 bit-identical** | none (every stage identical) | none |
| Same, mirrored RGB | 423 | **423 bit-identical** | none | none |
| Same pixels, timestamps jittered ±4 ms | 1,042 | **1,042 bit-identical** | features (v3 velocity uses time) | none (4 exact / 28 edits both) |
| 15 Hz lattice shifted by one 30 fps frame | — | different frames | observations (13/13) | output changed in 8/13 clips (A: 4 exact / 28 edits; shifted: 7 / 23) |
| One mid-capture frame dropped | 492 after the drop | only 113 identical | observations | output changed in 4/13 clips |
| 300 ms of frames removed | — | — | — | 13/13 quality-rejected ("Tracking was interrupted"), as designed |

**What a single dropped frame does.** After the drop, landmarks stayed different for 11–46 subsequent frames. In two clips they never reconverged before the clip ended.
- Typical maximum displacement: 0.005–0.06 normalised image units.
- Two rare clips: 0.20–0.26. The comparison is of each frame's first-listed hand, so these two may include a changed hand ordering.
- Cause: MediaPipe's VIDEO running mode carries tracking state (region of interest and landmark smoothing) from frame to frame.

**Conclusions**
- For identical input on one machine, tracking, features, inference and decoding are deterministic.
- Timestamps alone do not change landmarks; they change features only through velocity.
- Run-to-run differences in recorded and live capture come from **which frames are tracked**, amplified by tracking state.
- The CI CPU tracker's median of about 72 ms per frame (~13.9 Hz) is slower than the 15 Hz lattice, so slot replacement and drops are routine, and their timing varies between runs.
- Cross-machine, GPU-delegate and other-browser floating-point behaviour remain **untested**.

## 3. Regression investigation

There is no reproducible regression. Each comparison point the brief asked about:

- **Identical captured tensors:** none occurred between implementations, so a capture-level comparison cannot be paired. PR #50 already showed identical tensors give identical results through both session wrappers. §2 shows the whole post-capture path is deterministic.
- **Actual RGB observations and frame timestamps:** the candidate's repeats diverge first at `schedule`. The scheduling noise that §2 measured (different-frame lattices changed output in 8 of 13 clips, and one dropped frame in 4) is larger than the candidate-versus-baseline differences.
- **Tracking output:** deterministic for identical frames, so any difference comes from different frames.
- **Inference and decoding:** deterministic. No weight or threshold was touched to change any outcome.
- **Rare-mirrored 0 vs 3:** pre-registered follow-up, four more matched repeats per view, results below.

**Follow-up result.** The decision rule was fixed before seeing the data: a reproducible harm would need a consistent excess of candidate edits in the new repeats.
- **New repeats (3–6), candidate fewer / more edits:** mirrored 4 / 3, original 3 / 2. The 0 / 3 from repeats 1–2 did **not** reproduce.
- **Pooled over 6 repeats:** mirrored 13 vs 11 exact and 25 vs 26 edits; original 14 vs 14 exact and 34 vs 31 edits, out of 396 characters each.
- **Conclusion:** no regression is supported. Repeat consistency stayed low for both implementations (rare cases with the same text in all 6 repeats: 2/5 vs 2/5 original, 2/5 vs 1/5 mirrored). That matches the scheduling noise in §2.

The capture fix is correct by construction: a `VideoFrame` keeps pixels and timestamp together. In synthetic frame-identity tests it removed pixel/timestamp mismatches entirely (11/316 → 0/334 at 30 fps; [previous report](../README.md)). Its effect on recorded-RGB recognition is within the measured scheduling noise, so recognition benefit is **not** claimed.

## 4. Frame and timestamp validation

- **Synthetic frame identity.** At 30 fps, 11/316 → 0/334 tracked frames carried another frame's timestamp, and 0/233 on the final head. This identity check is only possible with a synthetic pattern.
- **Recorded runs.** Both implementations had the same median observed capture rate and median maximum frame gap (133.4 ms for positive and rare catalogs, 67 ms for negatives). Every case completed in both. A one-frame mismatch keeps intervals at camera multiples, so recorded timestamps alone cannot reveal it; that is why identity was measured synthetically.
- **Lockstep study.** Timestamp perturbations of ±4 ms leave landmarks bit-identical, so the fix's benefit is confined to velocity features. That matches its neutral recorded-RGB outcome.

## 5. Word-mode timing (capture clock unchanged by default)

**Root cause of the synthetic YES loss.**
- The YES rule requires a stable ending spanning **≥75 ms** of samples (`last.time - samples[tail].time < 75` in `completedFistNod`).
- At 15 fps, consecutive true capture times are 66.7 ms apart, which is below that window. So two still samples cannot satisfy it, and the tail reaches back into the motion.
- The legacy pick-up clock stretches every interval to the tracking lane's busy time. That lets two samples "span" 75 ms that were never observed.
- Measured on the experiment's schedules ([evidence/capture-clock-rules.json](evidence/capture-clock-rules.json)), the share of consecutive intervals under 75 ms is:

| Camera, tracking time | Capture-time clock | Pick-up clock |
|---|---:|---:|
| 30 fps, 80 ms | 41 % | 23 % |
| 15 fps, 80 ms | 69 % | 23 % |
| 15 fps, 110 ms | 26 % | 0 % |

**Causal check.** This was a scratch edit, not committed. Changing only that window from 75 to 60 ms (`sed -i 's/samples\[tail\].time < 75/samples[tail].time < 60/' lib/asl-starter-recognition.ts`, then the opt-in report) moved YES from 51 (legacy) vs 43 (capture time) to **60 vs 59**. Differing runs fell from 10 to 3, and the 43/43 synthetic negative triggers were unchanged under both clocks.

**Other temporal assumptions.** The starter rules also use a ≥5-sample minimum, 160/220/280 ms minimum durations, 60 ms peak margins and fixed 650/1100/1700/2600 ms windows. Sample-count gates depend on frame rate, and duration gates depend on how the timestamps were produced.

**Not changed.** The window was not changed in production, and the capture clock was not enabled by default. Recorded word-sign comparisons remain **blocked**: the only word replay source (PopSign) still fails its publisher certificate (exit 78 in this sprint's CI). The previous sprint's "11/128 differing runs" was an arithmetic error; the experiment is deterministic, and the correct count is **10/128**.

## 6. Privacy and resource stability

**Privacy boundary.** `tests/diagnostic-privacy-boundary.test.ts` fails if production code calls the landmark trace export, references run fingerprints outside the three diagnostic modules, or sends any analytics event other than `page_view`. It was mutation-checked with a planted leak.
- Analytics: emits only consent-gated page views.
- Local storage: holds only settings, transcript history and onboarding/consent.
- Research export: an explicit allowlist (tested).
- Determinism artifacts: hold counts, deltas, CER and fingerprints only; frames and landmarks stay on the runner.
- Recorded-RGB ledgers: kept as 14-day CI artifacts, as in PRs #49 and #50. The committed evidence is aggregate only.

**Lifecycle soaks** (headless Chromium, synthetic camera; not GPU, WASM-arena, mobile or physical-device evidence). Data: [evidence/soak.json](evidence/soak.json).

| Soak | Unclosed-handle warnings | Post-GC JS heap |
|---|---:|---|
| 10 min, 10 mode switches, PR #51 | 0 | 5.66 → plateau 6.31 MB (from about minute 4) |
| 10 min, 10 mode switches, PR #50 | 0 | 5.69 → plateau 6.28 MB |
| 5 min, 63 Start/Finish captures, PR #51 | 0 | 5.66 → 6.19 MB, slow growth |
| 5 min, 63 Start/Finish captures, PR #50 | 0 | 5.65 → 6.12 MB, the same slow growth |

Slow post-GC growth of about 0.1 MB per 5 minutes with repeated captures exists in **both** builds, so it is pre-existing. The candidate ended 0.07 MB higher, within this soak's sample noise (single samples spike by up to 0.27 MB). It is small but not shown to be bounded over hours, so long-session memory remains unqualified.

**`VideoFrame` ownership.** Every handle is closed in `finally`, including on fallback, repeat and close-while-pending paths. These are covered by 12 unit tests from the previous sprint, plus the soak warnings above.

## Reproduce

All commands below are builds, tests or diagnostics; none deploys anything.

Recorded-RGB matrix, determinism study and rare follow-up (CI, push-triggered on this branch):
- `.github/workflows/pr51-recorded-validation.yml`
- `.github/workflows/pr51-tracking-determinism.yml`
- `.github/workflows/pr51-rare-followup.yml`

Summary, printed in the CI log and uploaded without identifiers: `.github/workflows/pr51-recorded-summary.yml`.

Locally, from your own ledgers:

```sh
python scripts/diagnostics/summarize-pr51-recorded.py <ledger-dir> work/summary.json
```

Word-clock report with the interval statistics:

```sh
RUN_CAPTURE_CLOCK_REPORT=1 SIGNRELAY_CAPTURE_CLOCK_REPORT=work/clock.json npx vitest run tests/capture-clock-rules.test.ts
```

Soak (10 minutes, 10 mode switches):

```sh
node scripts/diagnostics/capture-soak-browser.mjs "$CHROME" fingerspelling 600 work/soak.json 10
```

Soak with repeated Start/Finish captures (5 minutes):

```sh
node scripts/diagnostics/capture-soak-browser.mjs "$CHROME" fingerspelling 300 work/soak-captures.json 0 1
```

## Rollback

- **Capture fix only:** revert `39a21e4` on a new branch.
- **This validation sprint:** it adds only diagnostics, workflows, tests and documents. Revert the commits after `e71d88b`, or drop the three `pr51-*` workflows and `docs/engineering-sprint-2026-11-03/validation/`.
- **Stored data, models, branding and language infrastructure:** not touched.
- **Firebase:** not deployed.
