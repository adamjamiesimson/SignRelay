# ASL stroke boundaries and recall guard, 17 October 2026

**Subsequent diagnostic follow-up:** [Remaining misses and reviewed collection](asl-miss-diagnosis-2026-10-17.md) identifies tracking, rule-match, ambiguity and confirmation limits without changing production recognition behavior. It prepares a 144-slot development collection/import workflow; no new participant recordings or fluent reviews are claimed.

**Decision: keep draft PR #30 in review.** On the six previously inspected historical development recordings, the missed PLEASE is restored and THANK YOU `.8033` stops emitting PLEASE. That THANK YOU now abstains; it is not correctly translated. The five additional development recordings retain their prior outputs. These results do not establish live translation accuracy or unblock release.

## What was repaired

The PLEASE completion rule compared the beginning and end of an entire rolling window. A continuing circular movement can contain a completed revolution while those endpoints remain far apart. Per-frame body-anchor and scale changes also distorted the apparent path. Circle completion now searches suffixes ending at the current observation, using the palm center in one camera coordinate system and a common window scale. Existing body-relative chest location and wrist-excursion checks remain, so pose-anchor motion or rigid body travel alone cannot satisfy the rule. A completed loop from an earlier, different movement is not revived.

The wrong THANK YOU recording approached the mouth after preparation, then departed. Its wrist nevertheless passed the old circle test. Two face-local open-hand observations now locate the closest mouth approach independently of the rolling-window start. Existing departure and outward requirements still determine whether THANK YOU can emit. A mouth departure vetoes an open-palm chest-circle emission; incomplete mouth and wrist-circle evidence both remain available to cross-window ambiguity arbitration, including model fallback. The original incomplete-PLEASE safeguard remains.

No existing numerical confidence, margin, distance, closure, cooldown or streak threshold was relaxed. The new mouth-onset cue requires two observations. Neural weights, model mappings and personal-template arbitration are unchanged; all 56 installed model assets match the prior recorded fingerprints.

The historical video gate now rejects a loss of a previously correct recording even if another trial replaces it in aggregate. It also requires matching decoded-frame counts. A negative control using the genuine pre-PR28 CI baseline rejects the earlier aligned worker with `Lost correct recognition on please-gtsignstudy4a.8031: PLEASE`; the repaired worker passes.

## Recording results

| Previously inspected development cohort | Worker | Correct | Wrong accepted | Abstained | Trial errors |
| --- | --- | ---: | ---: | ---: | ---: |
| Historical, 6 recordings / 2 source signers | Before repair | 2 | 1 | 3 | 0 |
| Same historical recordings | Repaired | 3 | 0 | 3 | 0 |
| Additional, 5 recordings / 4 source signers | Before repair | 2 | 0 | 3 | 0 |
| Same additional recordings | Repaired | 2 | 0 | 3 | 0 |

Only two historical outputs change: PLEASE `.8031`, abstention → PLEASE; THANK YOU `.8033`, PLEASE → abstention. Historical capture remains 220 decoded frames / 101 hand-visible frames; additional capture remains 194 / 49. No previously correct recording is lost. The broader set still recognizes only five of eleven recordings correctly.

Protocol: production VisionEngine and bundled recognition worker, exact installed MediaPipe JS/WASM 0.10.35, Chrome for Testing headless shell 151.0.7922.34, unique unmirrored decoded source frames at at most 20 Hz, fresh tracker/worker state per clip, no added ending pause. Final candidate runs use normal evaluation with no frame retention. Earlier explicit development traces were used to investigate the failure and remained in ignored local storage. Trace mode is rejected before opening a final-holdout manifest. Derived JSONL files contain no captured landmarks or media.

Before rows record evaluator parent `cc60c11c0aa160899ce6c371c0ae5c0c1e68dcf4`; final rows record checkpoint parent `5bc014348c1d5ee4d0eb1bd660c26fd73d3b33e2`. Both correctly retain `harness_dirty=true`: local trace tooling and then the repair were uncommitted during capture. Before worker SHA-256 is `c016a365d0c73455aa6564affabee35d5d49d0ed824b7b59d8bdf5a986b7d7fe`; repaired worker is `8a7d967e8c23ce76078cde1db5cb6672fcb5eef209ab207c7da539b829f860cd`. [Verification metadata](asl-stroke-repair-2026-10-17/verification.json) fingerprints the exact source and captured files. Rows are preserved without relabelling their source commits.

The pre-PR28 negative control uses unmodified baseline rows from CI run `38882717284`, artifact `12038551298`, ZIP SHA-256 `c809d44a2efa35e2ea75c2b80cfa6d5bc1b4e5a34919c5f439a529f31817f668`. That cross-environment check supplements the fresh local before/after pairs; the PR workflow rebuilds both frozen baseline and candidate together for its own comparison. Local browser summaries observed aborted blob loads during teardown; completed trial rows have empty error arrays.

## Verification and cost

343 tests pass, including continuing circles, body-reference jitter, rigid travel, mouth preparation/departure, open-palm ambiguity, model-fallback rejection, repeated/successive signs, trace isolation and per-recording recall loss. These constructed controls are software regression cases, not signing-accuracy observations. Typecheck, lint, secured static export and rendered HTML checks pass. Browser checks pass for workspace/camera/transcript lifecycle and ASL/BSL/ISL/LSE model cancellation and fresh/cached execution; they do not measure sign accuracy.

Suffix search adds CPU work. On this Linux x64 Node 24.19.0 container, alternating 120 measured runs after 30 warmups gives two-hand unfinished-arc p95 of approximately 3.01 ms for 52 samples, versus 1.55 ms before. A 120-sample, 50 Hz stress history gives approximately 9.11 ms, versus 3.36 ms. The app targets at most 20 Hz; these are container measurements, not phone FPS. [Timing data](asl-stroke-repair-2026-10-17/starter-timing.json) records the synthetic workloads and maxima.

Fresh full dependency audit still reports five high-severity development-tool findings; production audit reports zero. No dependency or waiver was added. The existing Firebase check remains blocked by that strict full audit until its supported dependency repair is available and verified.

Remaining release work: independent fluent-signer review, real SORRY coverage, real no-sign/OOV negatives, and physical-phone/handedness measurements. No negative recordings were added, so no-sign and unknown-sign false-acceptance rates remain null. The five reserved holdout recordings were not fetched, viewed or evaluated. No merge, deployment or model replacement was performed.

[Derived rows, paired reports, audit results and source fingerprints](asl-stroke-repair-2026-10-17/).
