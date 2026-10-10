# Stage 2 experiment — hand sensitivity, 9 October 2026

## Hypothesis

MediaPipe hand detection is absent during many frames in the PopSign ASL held-out video clips. Test whether modest reductions in hand detection/presence confidence (`0.55 → 0.45`) and tracking confidence (`0.55 → 0.50`) improve signed-word recall without increasing mistaken sign acceptance.

**No model thresholds or pretrained weights changed.** The experiment was conducted only in the draft GitHub development branch using the existing fixed ten-video test set.

## Controlled experiment

- Baseline: [paired browser evaluation #37930947424](https://github.com/adamjamiesimson/SignRelay/actions/runs/37930947424) with all three MediaPipe hand thresholds at 0.55.
- Sensitivity variant: [paired browser evaluation #37939521548](https://github.com/adamjamiesimson/SignRelay/actions/runs/37939521548), two settings at 0.45 and tracking at 0.50.
- Both runs used eight PopSign isolated ASL videos and two Wikimedia Commons non-sign-intent videos and the same benchmark workflow.

| Metric | Baseline replay A/B | Sensitivity replay A/B |
| --- | --- | --- |
| Signs recognized correctly | 3/8, 3/8 | 0/8, 0/8 |
| HELLO mistaken for THANK YOU | Yes, both | Yes, first only |
| Non-sign-intent clips rejected | 2/2, 2/2 | 2/2, 2/2 |
| Prediction/outcome mismatch between paired runs | 0/10 | 1/10 |
| Total frames to worker | 404, 407 | 216, 215 |

The baseline and experimental runs have different frame-processing counts and were run on different CI jobs, so the accuracy difference cannot conclusively be attributed **solely** to the sensitivity settings. There is nevertheless **no positive evidence** to support this parameter change, and the observed results are worse.

## Decision

**Reverted the parameter change and restored its corresponding test.** Production MediaPipe hand detection/presence/tracking confidence remains at `0.55`. The live Firebase site and `main` were never changed.

## Next technical work

1. Characterize videos with near-zero detected hands: compare original crop, horizontal mirroring, MediaPipe detection, screen coverage, and missing hand landmarks. Avoid claiming low sensitivity alone is the cause.
2. Trace the HELLO → THANK YOU starter heuristic using per-frame derived evidence (without storing raw landmarks). The branch already has optional derived mouth-motion evidence; use it before introducing additional rules.
3. Freeze an enlarged evaluation set with independently verified labels, contrasting intentional signs and ordinary hand motion, and use multiple runs before accepting changes.
4. Avoid loosening classifier confirmation rules until sign confusion and non-sign false accepts can be measured reliably.

This is an exploratory smoke test, **not a representative estimate of sign language translation accuracy**.
