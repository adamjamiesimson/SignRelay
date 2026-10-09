# SignRelay first real-video smoke benchmark — 9 October 2026

## Summary

**This is a limited diagnostic, not a representative live-camera accuracy estimate.**

- Dataset: [PopSign ASL v1.0](https://signdata.cc.gatech.edu/view/datasets/popsign_v1_0/), Georgia Tech / Deaf Professional Arts Network, **CC BY 4.0**.
- Category/split: `game/test`. Four signs selected **before examining predictions**: HELLO, NO, YES, PLEASE.
- Two archived clips per sign, selected by distinct source signer identifier within each sign. These are *not* asserted to be signer-independent of SignRelay's WLASL model training.
- Run: [GitHub Actions #37916495841](https://github.com/adamjamiesimson/SignRelay/actions/runs/37916495841), head commit `0ccb091c34941ee603e4aa64580bf50a3267f011`.
- Pipeline: static Firebase export, headless Chrome, actual camera-facing browser MediaPipe and recognition worker via local video-backed MediaStream. Fixtures were never committed or included in artifacts.
- Evaluator: `npm run eval:video -- evaluation/popsign-test.local.jsonl --language asl --trial-timeout 25000 --camera-timeout 120000 --tail 3500 --output work/popsign/results.jsonl --report work/popsign/report.md`.
- Artifact: `popsign-asl-limited-video-report` from that GitHub Actions run (metadata-only).

## Measured outcomes

| Expected sign | Trials | Accepted correctly | Rejected | Hand coverage (%) |
| --- | ---: | ---: | ---: | --- |
| HELLO | 2 | 0 | 2 | 25.0, 80.0 |
| NO | 2 | 1 | 1 | 9.1, 23.1 |
| YES | 2 | 0 | 2 | 44.4, 23.1 |
| PLEASE | 2 | 1 | 1 | 81.8, 54.5 |
| **Overall** | **8** | **2** | **6** | **42.6 mean** |

- Signed-trial accuracy: **2/8 = 25%**; accepted-sign coverage: **25%**.
- Precision among accepted outputs: **2/2 = 100% on this tiny sample only**; no incorrect word was accepted.
- The two correct recognitions were NO (86% interface confidence, about 2,129 ms from clip start) and PLEASE (86%, about 2,267 ms).
- **No real-world no-sign/background trials were included**; false accept rate cannot be estimated.
- No evaluator infrastructure errors/timeouts were reported. Core CI tests passed. A successful GitHub Actions job does **not** mean recognition quality passed.

## Repeatability check: identical videos, different outputs

A second CI run, [#37917036143](https://github.com/adamjamiesimson/SignRelay/actions/runs/37917036143), replayed **the same eight clip IDs with matching SHA-256 checksums for all eight video files**. The browser recognition outputs differed:

| Metric | First run (#37916495841) | Repeat (#37917036143) |
| --- | ---: | ---: |
| Correct accepted | 2 / 8 | 0 / 8 |
| Rejected | 6 | 7 |
| Wrongly accepted | 0 | 1 (PLEASE → STAR) |
| Accepted coverage | 25.0% | 12.5% |
| Mean hand coverage | 42.6% | 43.3% |
| Non-sign false-accept rate | unmeasured | unmeasured |

The repeat did not recognize NO or PLEASE correctly. One PLEASE clip produced **STAR** at 74% interface confidence, when the same clip had correctly produced PLEASE at 86% in the first run.

**Critical limitation:** the evaluator currently has fixed source-video bytes but does *not* guarantee deterministic playback cadence, MediaPipe tracking or async inference timing. These runs establish **end-to-end recognition/replay instability**, not whether the underlying classifier, the browser harness, or both are responsible.

**Immediate implication:** prioritize timestamped pipeline event traces, clip frame delivery counters, and repeated-same-clip trials in a controlled browser environment **before** comparing recognition-model changes or setting an accuracy baseline. Do not treat either run's 25% or 0% as a stable model-quality estimate.

## What the failure pattern suggests

1. **Low hand tracking coverage is a strong suspect**, especially the rejected NO clip (9.1%) and one HELLO clip (25.0%). The full upper-body/person tracker was active during most of those trials, indicating a more selective issue with hand localization, occlusion, framing, landmark thresholds, or timing.
2. **Tracking does not explain everything**: another HELLO clip was rejected despite 80% hand coverage, and PLEASE had one success at 81.8% and one rejection at 54.5%. Motion segmentation, starter-sign geometry, model-domain shift, and confidence/consensus gating need separate investigation.
3. **Short source clips** (about 1.9–2.8 seconds) may interact with segmentation/confirmation and are not identical to an interactive signer pausing naturally. Replay included a 3.5-second tail to permit completion.
4. **All rejected trials ended with “No confident match.”** That is not enough evidence to lower thresholds blindly: doing so might increase erroneous transcripts and fist/YES confusions.

## Next investigations before changing runtime thresholds

1. Add **stage-by-stage per-clip diagnostics** that separate hand-tracking availability, detected completed movement, candidate recognition, confidence gating, and final confirmation. Keep private video and landmarks out of committed artifacts.
2. Add properly licensed **realistic no-sign clips** (ordinary hand motion, idle hands and transitions) and report false accepted words, rather than relying on a black-screen control.
3. Repeat each fixed clip on a consistent runtime, and expand to more unseen signers/lighting/device conditions. Freeze video checksums and selected clip IDs so future before/after comparisons are valid.
4. Only then adjust hand-tracking/segmentation settings or thresholds in a controlled branch, comparing correct/rejected/false-positive rates together.
5. Seek native-signing expertise for assessing sign variants and interpretation; this benchmark measures isolated label recognition, not full translation.

**Interpretation:** The first real browser/video regression pipeline runs successfully, but it exposes serious gaps in recall for this tiny test set. Do not market it as 25% universal ASL accuracy or declare the model reliable; retain experimental status.

## Follow-up: stage tracing and real-world non-sign activity (9 October)

The trace-enabled browser runner was tested against **eight PopSign ASL sign clips** and **two licensed Commons non-sign-intent clips**. Both Commons files downloaded and passed browser replay:

- `HandWaveExample.webm`, by **NMu11er**, CC BY-SA 4.0. Ordinary waving may visually overlap with a sign: this is a *non-sign-intent control*, not unambiguous evidence that all wave-like output is incorrect.
- `Fish on hand.webm`, by **KEmel49**, CC BY-SA 4.0. Ordinary human hand activity, not ASL instruction.

| Experiment (Actions) | Source-video policy | Signs correct / 8 | Incorrectly accepted signs | Non-sign accepted / 2 |
| --- | --- | ---: | --- | ---: |
| [#37920067474](https://github.com/adamjamiesimson/SignRelay/actions/runs/37920067474) | Continuous stream with repeated held image frames | 0 | HELLO → THANK YOU | 0 |
| [#37920542110](https://github.com/adamjamiesimson/SignRelay/actions/runs/37920542110) | Canvas redraws only when source video progresses; stream is still clocked | 1 | HELLO → THANK YOU | 0 |
| [#37921013789](https://github.com/adamjamiesimson/SignRelay/actions/runs/37921013789) | `captureStream(0)` and explicit `requestFrame` upon source progress | 0 | HELLO → THANK YOU | 0 |

**Important repeatability finding:** Source-frame-only *canvas requests do not guarantee source-frame-only processing*. In run #37921013789, the first HELLO clip showed **22 source-image advances versus 70 worker frames**; the first PLEASE clip showed **18 versus 54**. The HTML video element displaying the captured stream can continue advancing its playback timestamp while reusing images. The production capture loop uses changes in `video.currentTime` as evidence of new frames, which may fail to distinguish a genuine newly decoded camera frame from a repeated held image. This is a hypothesis about the mechanism, not yet a proven live-camera defect.

### Pipeline-stage observations (run #37921013789)

- HELLO clip `...8037` was rejected: **2/70** worker frames had detected hands, and **67/70** motion-gate observations reported missing hands. Upstream hand detection is the immediate bottleneck for that clip.
- HELLO clip `...8032` was incorrectly confirmed as **THANK YOU**, despite hands detected in **52/53** worker frames. The worker emitted three THANK YOU candidates. This is a genuine recognition/heuristic confusion, not simply missing hands.
- NO clip `...8035` had hands in **3/61** worker frames and no candidates.
- PLEASE clip `...8038` had hands in **53/54** worker frames, **22 ready-gate events**, **22 pending-model analyses**, but no confirmation. Trace stages expose a possible inference/segmentation-timing problem that requires further inspection.
- Wave and fish clips were both rejected, but **0/2 negative accepts is insufficient to establish a general false-positive rate**. The waving clip actually reached the motion-ready gate and pending model stage, making it a useful challenging control.

### Engineering priorities based on evidence

1. **Frame identity:** Instrument `requestVideoFrameCallback`/presented-frame changes in the browser capture loop rather than assuming `video.currentTime` proves a new source image. Protect against repeated source images without losing genuine held-sign temporal context.
2. **Hand-tracking failure:** Inspect PopSign framing and MediaPipe hand landmark coverage for clips with 2–4 detected-hand frames. Do not reduce confidence thresholds to compensate for absent landmarks.
3. **Candidate confusion:** Reproduce HELLO → THANK YOU (high hand coverage) against signer/pose geometry; add a fixed negative test before modifying the starter rules.
4. **Classifier scheduling:** Inspect READY + model-PENDING without confirmations on PLEASE; record start/completion/invalidation of model inference before deciding how to tune.
5. **Broader evaluation:** Add more signers and ordinary background/no-sign clips to estimate reliability and false accepts with meaningful confidence.

All three workflows completed and published **metadata-only** artifacts. No raw PopSign or Commons videos are checked into the repository. The live Firebase site is unchanged.
