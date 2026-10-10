# Stage 2 — contrastive ASL THANK YOU / HELLO experiment (10 October 2026)

## What we observed before changing code

The original automatic THANK YOU heuristic could interpret the PopSign HELLO clip `popsign-hello-gtsignstudy4a.8032-02` as THANK YOU. A fixed, labeled PopSign v1.0 `game/test` fixture set was expanded **before** tuning to include two true THANK YOU clips alongside two HELLO, two NO, two YES, two PLEASE, and two licensed Commons non-sign-intent controls.

The original rule required a fingertip start within normalized mouth distance 0.4, sufficient downward movement, and outward separation. Per-frame *derived* diagnostic evidence from the baseline [#38031717401](https://github.com/adamjamiesimson/SignRelay/actions/runs/38031717401) revealed:

- Incorrect **HELLO → THANK YOU** samples began **closer to the nose than the mouth**: mouth distances ~0.272 and ~0.340 vs nose distances ~0.217 and ~0.278.
- Real THANK YOU candidate evidence began **closer to the mouth than the nose**: mouth distances ~0.072–0.232 vs nose distances ~0.174–0.329.
- These are *normalized kinematic distances*, not calibrated probabilities or facial landmarks stored in artifacts.

## Experimental change

Added an anatomical contrast check to the THANK YOU starter fallback:

```ts
const startsAtChinNotNose = !first.nose || chinDistance + 0.025 < noseDistance;
```

The existing mouth distance, movement direction, shape, sign confidence and acceptance rules remain unchanged. If nose tracking is absent, the old behavior remains. Four contrastive synthetic regression cases (genuine chin movement from both hands, changed scale, and a nose-anchored downward movement) were added; Core CI passed for commit `57cb865`.

### Video results (12 matched clips, two runs each)

| Outcome | Baseline A | Baseline B | Contrast A | Contrast B |
| --- | ---: | ---: | ---: | ---: |
| Correct signed clips (out of 10) | 1 | 2 | 3 | 4 |
| HELLO → THANK YOU misclassifications | 1 | 0 | 0 | 0 |
| True THANK YOU clips correctly accepted (out of 2) | 0 | 1 | 1 | 1 |
| Incorrect THANK YOU → PLEASE classifications | 0 | 0 | 1 | 1 |
| Non-sign-intent clips wrongly accepted (out of 2) | 0 | 0 | 0 | 0 |
| Prediction/outcome changes between repeated A/B | 2 of 12 clips across baseline runs | — | 4 of 12 clips across contrast runs | — |

- Baseline: [Actions #38031717401](https://github.com/adamjamiesimson/SignRelay/actions/runs/38031717401), [metadata-only artifact](https://github.com/adamjamiesimson/SignRelay/actions/runs/38031717401).
- Contrast: [Actions #38032093658](https://github.com/adamjamiesimson/SignRelay/actions/runs/38032093658), metadata-only artifact.
- Both completed **as workflows**, not as accuracy acceptance tests. Some source-video/frame schedules differed between executions; observed changes cannot all be causally attributed to the anatomical rule.
- New real-video cases exhibited residual **HELLO → PLEASE** and **THANK YOU → PLEASE** failures, especially with tracker/jitter variation.
- The 10-signed-clip sample is far too small to support a universal accuracy improvement or a statistically sound false-positive rate.
- These particular clips have now influenced development decisions, so they are **no longer independent held-out evidence** for future model-quality claims.

## Decision and follow-up

The contrast rule remains **experimental in draft PR #17 only**, with no merge or Firebase deployment. It is more anatomically specific than a fixed stricter mouth threshold and passed synthetic tests, but the new wrong PLEASE labels and replay variability prevent a production-quality claim.

Next: collect additional, previously unseen labeled HELLO / THANK YOU / PLEASE signers and genuine negatives; investigate upper-face vs chest movement segmentation/hand tracking. Require reliable recognition of legitimate THANK YOU and no regression in confusing sign classes before accepting a merge.

**Security reminder:** separate Firebase static-build audit previously flagged dependency vulnerabilities. Resolve that independent blocker before any live deployment.
