# ASL cross-sign confusion matrix (synthetic)

> Synthetic kinematic fixtures through the real recognition worker. Each sign row has 51 runs: 15 capture conditions plus 36 variations (mirrored hand, 3 speeds, 2 distances, clean/jitter/dropout). The non-sign row has 19 everyday movements × 36 variations. Not recordings and not an accuracy measurement. Regenerate with `UPDATE_CONFUSION=1 npx vitest run tests/asl-confusion-matrix.test.ts`.

## Starter rules only (model returns nothing)

| Intended | HELLO | NO | YES | PLEASE | SORRY | THANK YOU | I LOVE YOU | abstain | more than one word |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| HELLO | 51 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| NO | 0 | 51 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| YES | 0 | 0 | 51 | 0 | 0 | 0 | 0 | 0 | 0 |
| PLEASE | 0 | 0 | 0 | 51 | 0 | 0 | 0 | 0 | 0 |
| SORRY | 0 | 0 | 0 | 0 | 51 | 0 | 0 | 0 | 0 |
| THANK YOU | 0 | 0 | 0 | 0 | 0 | 51 | 0 | 0 | 0 |
| non-sign movement | 144 | 0 | 0 | 0 | 0 | 116 | 0 | 424 | 0 |

## With a confidently wrong closed-set model

The model reports the next core sign (HELLO→NO, …, THANK YOU→HELLO) at 0.95 on every inference, or PLEASE for non-sign movements. The table counts transcript insertions.

| Intended | HELLO | NO | YES | PLEASE | SORRY | THANK YOU | I LOVE YOU | abstain | more than one word |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| HELLO | 51 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| NO | 0 | 51 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| YES | 0 | 0 | 51 | 0 | 0 | 0 | 0 | 0 | 0 |
| PLEASE | 0 | 0 | 0 | 51 | 0 | 0 | 0 | 0 | 0 |
| SORRY | 0 | 0 | 0 | 0 | 51 | 0 | 0 | 0 | 0 |
| THANK YOU | 0 | 0 | 0 | 0 | 0 | 51 | 0 | 0 | 0 |
| non-sign movement | 144 | 0 | 0 | 0 | 0 | 116 | 0 | 424 | 0 |

## Research suggestions

| Intended | Trials with suggestions | Suggestions | Matching |
| --- | ---: | ---: | ---: |
| HELLO | 0 | 0 | 0 |
| NO | 0 | 0 | 0 |
| YES | 0 | 0 | 0 |
| PLEASE | 0 | 0 | 0 |
| SORRY | 0 | 0 | 0 |
| THANK YOU | 10 | 10 | 0 |
| non-sign movement | 64 | 64 | 0 |

## Wrong outcomes

- rules: non-sign movement → HELLO: 144
- rules: non-sign movement → THANK YOU: 116
- confidently_wrong_model: non-sign movement → HELLO: 144
- confidently_wrong_model: non-sign movement → THANK YOU: 116
