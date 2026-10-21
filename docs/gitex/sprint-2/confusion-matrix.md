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
| non-sign movement | 144 | 0 | 0 | 0 | 0 | 136 | 0 | 404 | 0 |

## With a confidently wrong closed-set model

The model reports the next core sign (HELLO→NO, …, THANK YOU→HELLO) at 0.95 on every inference, or PLEASE for non-sign movements. This tests source arbitration, motion gating and two-evidence confirmation against a model that is always wrong.

| Intended | HELLO | NO | YES | PLEASE | SORRY | THANK YOU | I LOVE YOU | abstain | more than one word |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| HELLO | 51 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| NO | 0 | 51 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| YES | 0 | 0 | 51 | 0 | 0 | 0 | 0 | 0 | 0 |
| PLEASE | 0 | 0 | 0 | 51 | 0 | 0 | 0 | 0 | 0 |
| SORRY | 0 | 0 | 0 | 0 | 51 | 0 | 0 | 0 | 0 |
| THANK YOU | 0 | 0 | 0 | 0 | 0 | 42 | 0 | 0 | 9 |
| non-sign movement | 132 | 0 | 0 | 44 | 0 | 120 | 0 | 368 | 20 |

## Wrong outcomes

- rules: non-sign movement → HELLO: 144
- rules: non-sign movement → THANK YOU: 136
- confidently_wrong_model: THANK YOU → more than one word: 9
- confidently_wrong_model: non-sign movement → HELLO: 132
- confidently_wrong_model: non-sign movement → PLEASE: 44
- confidently_wrong_model: non-sign movement → THANK YOU: 120
- confidently_wrong_model: non-sign movement → more than one word: 20
