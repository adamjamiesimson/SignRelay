# SignRelay Sprint 2 follow-up

**EXPERIMENTAL ONLY.** The paired comparisons use licensed, previously exposed development recordings. Independent signers and a real webcam session remain required for a release decision. The [paired webcam protocol](webcam-validation-protocol-2026-11-16.md) specifies those checks.

## Reviewed Git history

PR #61's head is `28a3a3bc9e872ff947f7238556b843a12f3ac25a`. The reviewed bundle adds six commits in a direct chain ending at `543322981cd601ba2edba176d6bf7756aaba2f7d`. Git verified the bundle and commit connectivity. The 21 changed paths contain code, tests, and derived evaluation results. The trace report has 42 rows. Checks found no recording payloads, raw landmark arrays, or credential patterns in the bundle delta.

## THANK YOU → PLEASE

On the locked development clip `thankyou-gtsignstudy4a.8033`, PR #61 confirmed PLEASE after two successive proposals. At those endpoints the wrist estimate was at normalized image y coordinates of 1.035 and 1.047. The tracker still reported a hand, and the chest-circle rule used the extrapolated palm path to close a loop. Inspection of the recording showed fingertips rising to the chin and moving forward. The publisher's expected gloss is THANK YOU.

The chest-circle rule now searches only after the last sample with an off-screen wrist. This gives an actual later circle a fresh opportunity to qualify. It also preserves the existing incomplete-motion and competing-sign evidence and the requirement for two confirming observations. Synthetic controls cover cropped and fully visible PLEASE and SORRY circles. The frozen recording, manifest, expected outcome and baseline gate definitions retain their original hashes.

In the controlled replay of the same 42 captured landmark streams, the new check changed just the targeted wrong PLEASE to an abstention compared with the reviewed candidate. It preserved the recognized positives on those captured inputs. This addresses a false insertion, and THANK YOU recall on the clip remains open.

| Controlled replay, 42 exposed recordings | Correct | Wrong | Abstained |
| --- | ---: | ---: | ---: |
| PR #61 | 8 | 9 | 25 |
| Reviewed bundle | 9 | 6 | 27 |
| Follow-up candidate | 9 | 5 | 28 |

## Dependency verification

Next.js and `eslint-config-next` are pinned to `16.4.6`. The lockfile installs cleanly with `npm ci`, and the repository's audit policy reports zero advisories for both the full and production dependency trees. The publisher lists `16.4.5` as the first fix for the recorded advisory. [Next.js advisory](https://github.com/vercel/next.js/security/advisories/GHSA-mfr8-8qww-v76h) · [16.4.6 release](https://github.com/vercel/next.js/releases/tag/v16.4.6)

## Browser replay and checks

| Windows browser replay | PR #61 correct / wrong / abstained | Reviewed bundle | Follow-up |
| --- | ---: | ---: | ---: |
| Locked 11-clip pilot | 5 / 1 / 5 | 5 / 1 / 5 | 5 / 0 / 6 |
| Nine targeted cohort A clips | 2 / 5 / 2 | 3 / 2 / 4 | 3 / 2 / 4 |

The follow-up produced identical frame and hand coverage to PR #61 in both paired runs. Both workers processed 414 frames with hands on 152 in the pilot and 406 frames with hands on 279 in the targeted replay. Neither produced a research suggestion in these runs. The unchanged local baseline gate passed with zero unexplained changes against its frozen expected outputs. The follow-up worker built and matched its export at SHA-256 `ea0b120983861f8a2b92890cc70a1ba1a88216ea4d30268c1bfc1b768720e7d5`.

Typecheck, lint, the repository asset guard, worker integrity, the ASL static build, two rendered HTML checks, the Chrome frame-step check, and the forced-failure browser check passed. All 52 focused recognition tests passed. The full Windows suite reported 914 passed, one skipped and six failures. The same six failures appear on PR #61 in the capture-intake, trial-log, dataset-integrity and glob-shim tests.
