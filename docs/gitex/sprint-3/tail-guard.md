# Confirmed-sign tail guard (Objective 10), 21 October 2026

**Status: OFF.** `ConfirmedSignTailGuard` (experiment `mask-confirmed-sign-tail` in `lib/asl-starter-experiments.ts`) is imported by no app or worker code. The production recognition worker (`ccce84c8…`), thresholds, rules, arbitration and two-evidence confirmation are unchanged. All numbers come from [`tail-guard.json`](tail-guard.json), regenerated with `RUN_TAIL_GUARD=1 npx vitest run tests/asl-tail-guard.test.ts`. They are synthetic kinematic fixtures through the real worker: not recordings, not accuracy, and not evidence that the guard helps real signers.

## The defect

When the worker confirms an ASL word it clears its frame buffer, but the rest of the same stroke keeps arriving. That remainder is then analysed as a fresh movement:

1. **Model tail word.** The closed-set model can label the remainder. With a confidently wrong model, THANK YOU was followed by a second word in 9 of 51 conditions (the Sprint 2 finding, reproduced exactly).
2. **Rule repeated from its own tail (new finding).** If the hand stays still in view after THANK YOU and then moves, the THANK YOU rule can match its own earlier mouth departure again once the 500 ms block and the 2.6 s same-word cooldown have passed. With no model at all, production gave **THANK YOU + THANK YOU** in 4 of the 6 THANK YOU "pause in view, then an unrelated movement" cases, and in all 3 "pause in view, then a model word" cases.

A related limit of the motion gate, not changed: with the hand kept in view, `analyzeSignMotion` does not re-segment at a rest, so the model can be shown the previous sign's tail plus the rest plus the next movement as one segment.

## The guard

After any confirmation, the filter replaces the hand with "no hand" in the frames posted to the worker, until the hand **rests**: out of view for 250 ms, or still within 0.035 body-reference units for 300 ms. From then on frames pass unchanged. It sits where the app posts camera frames, so the worker stays byte-identical. It never adds evidence.

| Synthetic scenario | Production | Guarded |
| --- | --- | --- |
| Six signs x 51 conditions, confidently wrong model | THANK YOU: 42 correct, 9 with an extra word | all six signs 51/51, no extra words |
| Everyday movements, rules only (684 runs) | HELLO 144, THANK YOU 136, abstain 404 | identical |
| Everyday movements, confidently wrong model | 316 runs with a word, 20 of them with more than one | 316 runs with a word, none with more than one |
| Rule word, pause in view, unrelated movement (36) | 7 with a second word (THANK YOU twice in 4) | THANK YOU never repeats. HELLO + a forehead-to-chest glide still gives THANK YOU, because that glide is itself THANK YOU-shaped (known risk) |
| Rule word, rest, then a model word (36) | THANK YOU, held still, gives THANK YOU twice in 3 | all 36 give the sign then the model word |
| Six-word demo and THANK YOU, HELLO, THANK YOU at 400/700/1500 ms rests; repeats after 2 s | correct | identical |

**Cost.** A movement that starts with no rest after a confirmed word is hidden until the hand rests. The demo script already asks signers to rest between words. In the one no-rest fixture, production also kept only the first word.

## Before turning it on

1. Run it against the real-video development clips with the existing pilot tooling, and compare with the baseline worker.
2. Record whether the rest it needs is natural for fluent signers (independent ASL review).
3. Wire it in front of `RecognitionSession.postMessage` for frames, and call `noteConfirmation()` on every `confirmed` message, behind an explicit off-by-default switch. Reset it whenever the session resets.

Do not tune its constants on the sealed holdout.
