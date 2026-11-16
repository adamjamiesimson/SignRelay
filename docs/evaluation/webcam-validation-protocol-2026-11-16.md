# Webcam validation protocol for the recognition sprint

For the project owner. About 30 minutes. Nothing here is replaced by automated tests. Use pseudonyms (`P01`), never names; do not record video or landmarks. Log every trial with `npm run eval:log` (rows go to the git-ignored `evaluation/results/`).

Setup: `npm ci && npm run demo:prepare && npm run demo:serve`, open `http://127.0.0.1:3000/?perf`, choose ASL, start the camera. Note device, browser, lighting and the `?perf` line (frames analysed per second, share of frames with a tracked hand) at the start and end.

Every trial gets exactly one outcome:

| Outcome | Meaning |
| --- | --- |
| correct | The word in the **transcript** is the word signed, and nothing else was added |
| incorrect | Any other word reached the transcript |
| no match | Nothing reached the transcript |
| failure | Camera, tracking or recognition stopped (note the message) |

A "Research-model suggestion · not added" card is **not** a transcript word. Record it separately: suggestion shown (yes/no), and whether it named the sign. Do not press Add during trials.

## A. Six signs, natural signing (36 trials per signer)

HELLO, THANK YOU, PLEASE, SORRY, YES, NO. Each sign six times: twice at normal speed resting the hand in view afterwards, twice at normal speed dropping the hand out of view afterwards, once slowly, once quickly. No retries until the expected word appears. Repeat the block with the other hand if the signer is comfortable doing so.

## B. Distance and light (12 trials)

HELLO and YES, three times each: at arm's length, at about 1.5 m, and with a window or lamp behind the signer.

## C. Everyday movements (false words)

Hands at rest for 30 s. Then twice each: adjust glasses, push hair aside, shield the eyes, lower a hand from the mouth, raise a hand to the forehead, wave, scratch the chin, reach for something off-screen, drink from a cup. Finish each by dropping the hand out of view. Any transcript word is a false word; any suggestion card is logged as a false suggestion.

## D. Other signs (false words)

Ten ASL signs outside the six (for example BOOK, DRINK, MOTHER, EAT, HELP). Any of the six words in the transcript is a false word.

## E. Performance

Sixty seconds of continuous signing: the `?perf` line must show at least 10 frames analysed per second with no throughput warning. Note the hand-tracked share.

## Rules

- Written consent before any signer other than the owner takes part; a fluent ASL reviewer confirms what was signed before results are quoted.
- Do not tune rules or thresholds on these trials and then re-measure on the same trials.
- A tracking failure is a failure, not a removed trial.
- These sessions say nothing about the sealed holdout, which stays unopened.
