# Evaluation and triage report

Release status: **NO-GO**. Development evidence and synthetic regression records only. Not accuracy, not live-camera or signer performance.

Current worker `ccce84c876f9`: 5/11 correct, 0 wrong, 6 abstained (CI paired pilot logs).

## Real-video development result (11 inspected clips)

| Sign | Trials | Correct | Wrong | Abstained |
| --- | ---: | ---: | ---: | ---: |
| HELLO | 3 | 1 | 0 | 2 |
| NO | 1 | 1 | 0 | 0 |
| PLEASE | 3 | 3 | 0 | 0 |
| THANK YOU | 3 | 0 | 0 | 3 |
| YES | 1 | 0 | 0 | 1 |
| SORRY | 0 | 0 | 0 | 0 |

## Triage

| Severity | Area | Issue | Evidence | Next action |
| --- | --- | --- | --- | --- |
| blocker | evaluation | No unseen, live-camera or new-signer evaluation exists | Only 11 previously inspected publisher clips (5 correct, 0 wrong, 6 abstained); the sealed holdout is unopened. | Collect reviewed recordings with the 144-slot plan and run the physical-camera manual gates. |
| blocker | evaluation | Real no-sign and out-of-vocabulary false acceptance is not measured | 0 real negative trials exist. | Record no-sign and unsupported-sign takes in the reviewed collection. |
| high | recognition | THANK YOU is never recognized on development clips | 0/3 correct, 3 abstained. | Diagnose with reviewed footage; see docs/gitex/sprint-2/experiments.md. |
| high | recognition | YES is never recognized on development clips | 0/1 correct, 1 abstained. | Diagnose with reviewed footage; see docs/gitex/sprint-2/experiments.md. |
| high | recognition | SORRY has no real-video trial | 0 development clips. | Include it in the reviewed collection before demonstrating it as supported. |
| high | false-accepts | Everyday movements trigger HELLO and THANK YOU in synthetic tests | 280/684 synthetic runs (THANK YOU/starter 136, HELLO/starter 144). | Keep the demo mitigation; evaluate the OFF experiments on reviewed footage before enabling any. |
| medium | arbitration | A model word can follow a starter confirmation on the same movement | 9 sign runs with an always-wrong confident model (THANK YOU → more than one word). | Decide on a guard that waits for a new movement onset after a starter confirmation; compare it with the baseline gate. |
| low | segmentation | Very short pauses (0–100 ms) lose a word | six words, 0 ms pause, hands lowered: 5/6; six words, 0 ms pause, hands held: 5/6; six words, 100 ms pause, hands lowered: 5/6; six words, 100 ms pause, hands held: 5/6 | Demo script keeps ≥400 ms rests with hands lowered. |

## Synthetic regression records (not accuracy)

- Adversarial non-sign runs producing a word: 280/684.
- Rules-only cross-sign confusions: 0.
- baseline: positives 90/90, sparse YES 29/36, adversarial runs with a word 280.
- hello-sideways-stroke: positives 90/90, sparse YES 29/36, adversarial runs with a word 172.
- thank-you-not-from-eyes: positives 90/90, sparse YES 29/36, adversarial runs with a word 180.
- thank-you-over-incomplete-please: positives 90/90, sparse YES 29/36, adversarial runs with a word 280.
- yes-gap-fill: positives 90/90, sparse YES 31/36, adversarial runs with a word 280.
- all experiments: positives 90/90, sparse YES 31/36, adversarial runs with a word 72.

Demo mitigation: Between signs, rest the hands below the chest or out of frame. Do not touch the face, glasses or hair, do not wave, shield the eyes or blow a kiss during the demonstration. Every confirmed word is labelled as a rule or model match and can be removed.
