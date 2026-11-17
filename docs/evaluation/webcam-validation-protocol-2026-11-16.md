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

## Paired comparison for the follow-up candidate

Freeze and record both Git commits and the recognition worker hashes before recruiting. Use a separate local export for each build. Recruit consenting fluent ASL signers whose recordings were absent from development, and give each a pseudonym. Have an independent fluent reviewer verify sign identity and variant. If the signer identity, intended gloss, or variant is uncertain, record that separately and resolve it before scoring. Keep developer rehearsals out of the comparison.

Use the same browser, device, camera framing, lighting and prompt list for both builds. Shuffle prompts within each block and alternate which build goes first across signers. Give the signer one attempt per prompt. Reset the transcript between prompts and use the same five-second observation window for both builds. Record all transcript words in order, and mark any second insertion of the expected word on a single sign separately as a duplicate. Keep model suggestions and suggestion matches in their own columns. Leave the suggestion card untouched.

Add these controls twice per build.

- Lift and lower a closed fist, hold a cup, and make an open-handed conversational sweep.
- Make a repeated wave, shield the eyes, and let a hand leave and reenter the frame.
- Sign one supported sign, then stop and restart the camera during the pause. Check for an unexpected insertion during the pause, then sign again. Repeat with a language switch and with two intentional repetitions separated by a rest.

Use the `?perf` overlay for the analyzed frame rate, tracking time, worker round-trip time, queue wait, dropped frames and hand coverage. Sample it every ten seconds during the same one-minute block. Record browser CPU over that minute with the browser or operating-system task manager. For end-to-end latency, have an observer mark the end of the visible stroke and the first transcript insertion with the same clock. Report the median and 95th percentile for accepted trials and include the count. Record abstentions as their own outcome and include all camera or processing failures in the results.

Compare per-signer and per-sign correct, wrong, abstained and failed trial counts. Count everyday-motion false inserts, unsupported-sign false inserts, duplicates and suggestions separately. Review all newly wrong trials before a release decision. If a result informs any change to the candidate, use new signers and recordings for the next comparison.
