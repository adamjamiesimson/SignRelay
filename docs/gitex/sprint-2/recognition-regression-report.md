# Sprint 2 recognition-regression report

**No production recognition decision changed in Sprint 2.** The shipped recognition worker is byte-identical to the Sprint 1 head: SHA-256 `ccce84c876f95caf9cade9a93fad1b686d5009a77ada203049044ee17ceb5632`. `npm run build:worker` reproduces it, and `verify-runtime` checks it against the committed bundle in every export.

Unchanged:
- models and weights;
- thresholds (0.62);
- the 2.6 s cooldown;
- two-evidence, same-source confirmation;
- stale-result rejection;
- open-palm ambiguity abstention;
- the cohort lock.

The only source change in recognition code is that `circularMotion` is now exported for geometry tests. The bundle bytes are unchanged.

## Real-video evidence (development clips only)

| Check | Result |
| --- | --- |
| Paired video pilot vs the frozen pre-PR28 worker (`verify-video-pilot.mjs`) | Pass. No new wrong acceptance, no lost correct outcome (CI runs 39570276547, 39573034510) |
| **New:** gate vs the exact established baseline (`baseline-gate.mjs`, Objective 14) | `ok: true`, **0 changes on all 11 trials**, candidate worker `ccce84c8` (CI run 39573034510) |
| Outcome | 5 correct, 0 wrong accepted, 6 abstained, of 11 previously inspected, publisher-labelled clips |

These are not unseen, live-camera or new-signer results. The sealed holdout (5 clips) was never fetched, inspected or evaluated, and fingerprint refusal is still tested.

## Synthetic regression records (exact-match tests; not accuracy)

| Suite | Record | Result |
| --- | --- | --- |
| Cross-sign regression (existing) | `tests/asl-cross-sign-regression.test.ts` | 92/92 |
| Adversarial non-sign inventory | `docs/gitex/adversarial-inventory.json` | 280/684 runs produce a word (HELLO 144, THANK YOU 136); every accepting pattern has an explanation |
| Confusion matrix | `docs/gitex/sprint-2/confusion-matrix.json` | Rules alone: 0 cross-sign confusions across 306 sign runs. Always-wrong model: THANK YOU followed by a model word in 9/51 runs (finding) |
| SORRY/PLEASE loop geometry | `tests/asl-sorry-geometry.test.ts` | 52/52. Strokes and zigzags are never loops; partial arcs never emit; ellipses and noisy circles close; figure-eight recorded |
| Temporal segmentation | `docs/gitex/sprint-2/temporal-stress.json` | Only intended words, in order, in all scenarios. YES is lost at ≤100 ms pauses and at 5–8 fps |
| Experiments (all OFF) | `docs/gitex/sprint-2/experiments.json` | Production baseline unchanged. Experiments are not in the worker bundle |

Any change to these records fails CI until the record is regenerated and the change is explained.
