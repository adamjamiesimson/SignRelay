# Starter recognition reliability and multilingual output safety

Stacked on PR #54 (`632607f`). Draft PR #55, branch `claude/charming-thompson-2aql9w-starter`.

How each result was obtained is stated:
- **synthetic:** kinematic fixtures;
- **recorded RGB:** licensed WLASL clips processed only on a CI runner;
- **local:** headless Chromium with a synthetic camera.

None is a physical-device or independent-signer measurement. **Asking a person to add a word does not make any recognizer more accurate.** It only changes what reaches the transcript without a decision.

## 1. Root causes of starter-rule false confirmations

### Synthetic reproduction

`tests/starter-false-trigger-report.test.ts`, run on demand, uses the exact PR #54 worker with the research model silent. It replays 684 everyday-movement takes (19 gestures × 36 capture variations), plus 11 negative controls and 306 genuine starter-sign takes.

| Starter word | False triggers | Gestures that trigger it (takes) |
|---|---|---|
| **HELLO** | 144 + 2 controls | pushing hair aside near the forehead (36), raising an open hand chin→forehead (36), waving to someone across the room (36), blowing a kiss (24), tucking hair behind the ear (12) |
| **THANK YOU** | 136 + 2 controls | adjusting glasses (36), pushing glasses up the nose (36), lowering a hand from the mouth to rest (36), shielding the eyes (28) |
| NO, YES, PLEASE, SORRY, I LOVE YOU | 0 | — |

- **Totals:** 280 of 684 everyday takes (41%) and 4 of 11 controls produce an automatic word. All 306 genuine-sign takes are still recognised exactly.
- **Capture conditions barely matter:**
  - hand side: Left and Right both 140 of 342;
  - distance: d0.85 and d1.15 both 140 of 342;
  - tracking quality: clean 96, jitter 96 and dropout 88 of 228;
  - speed: ×0.7 100, ×1 104, ×1.4 76 of 228.

  Tracking quality and frame rate are therefore **not** the cause.
- **The cause is rule geometry.** Each rule fires on a motion *pattern* near the face that ordinary movements share:
  - **HELLO:** an open hand above the shoulders moving sideways, with any reversal *or* a start "near the head". The "near the head" radius is 0.8 shoulder widths, so a sideways sweep at forehead height (hair) or a wave qualifies.
  - **THANK YOU:** an open hand whose fingertip starts within the mouth radius and then moves down and away, *sideways or forward*. Glasses, eye-shielding and lowering a hand from the mouth all start at the face and drop away.
  - **Neither rule requires the sign to finish.** Both fire while the hand is still travelling, before it settles or returns to rest. That is when the worker's two-agreeing-results confirmation completes.
- **The synthetic fixtures cannot settle this alone.** The synthetic HELLO is a side-to-side wave at upper-chest height, and the synthetic THANK YOU is a straight diagonal from the mouth. Kinematically, those are the false-trigger gestures. Real ASL HELLO starts at the forehead and moves outward; real THANK YOU moves forward toward the addressee. Any rule change therefore has to be judged on real recordings.

### Recorded RGB

`.github/workflows/starter-reliability.yml` processes WLASL direct clips (C-UDA licence) only on the CI runner. The capture uses the production VisionEngine in headless Chrome with the **exact PR #54 worker** (`git show 632607f:public/workers/recognition.worker.js`). The rule variants are then replayed on the captured landmarks with the research models silent. Landmarks never leave the runner; the log and artifact hold counts, glosses and rule measurements only.

The sets, built by `scripts/asl2000-eval/starter-sets.py` from a hash-verified index:

- **exposed-negative:** the 120 F1 clips (119 still downloadable). These are already-seen regression data and are reported separately.
- **heldout-negative:** 30 direct clips of other signs, never used before. This is every direct clip that was available.
- **dev-positive:** 16 clips of the six starter signs from the WLASL train split.
- **heldout-positive:** 11 clips from the val/test splits.

Two independent captures (run [41766216048](https://github.com/adamjamiesimson/SignRelay/actions/runs/41766216048) on `047f216` and run [41767216986](https://github.com/adamjamiesimson/SignRelay/actions/runs/41767216986) on `ef15d3c`) gave **identical words for all 176 clips in every variant**.

**PR #54 baseline, starter rules only:**

| Set | Clips | Clips with a wrong automatic word | Wrong automatic words |
|---|---|---|---|
| exposed-negative | 119 | 22 | 25 (THANK YOU 9, SORRY 7, PLEASE 6, NO 1, HELLO 1, YES 1) |
| heldout-negative | 30 | 8 | 8 (PLEASE 3, THANK YOU 3, SORRY 1, HELLO 1) |
| **all negatives** | **149** | **30 (20%)** | **33** |

**Per sign, all 176 clips:**

| Starter word | Recalled on its own clips | Wrong words on other signs | Precision | Signs that trigger it |
|---|---|---|---|---|
| NO | 6/6 | 1 | 6/7 | FEW |
| PLEASE | 5/5 | 9 | 5/14 | BABYSITTER, BANANA, BENEFIT, COMPUTER, FOOTBALL, HAPPY, INSPECT, PROFESSIONAL, STRAWBERRY |
| SORRY | 3/3 | 8 | 3/11 | APPOINTMENT, BASEBALL, CHANGE, GYMNASTICS, OPERATE, PARTY, PLAY, SATURDAY |
| HELLO | 1/2 | 2 | 1/3 | FUTURE, NICKEL |
| THANK YOU | 1/4 | 12 | 1/13 | BAD, BANANA, BIBLE, CAMEL, COMPUTER, DELAY, FOOTBALL, REST, SAD, SYMBOL, VOMIT, WEATHER |
| YES | 0/7 | 1 | 0/1 | PROBLEM |
| I LOVE YOU | not in the WLASL direct set | — | — | — |

No starter word fired on another starter sign's clips; every error is on a non-starter sign.

**Root causes on real signing.** The per-window diagnostics (`starterDiagnostics`) show three distinct mechanisms. None of them is frame rate or tracking gaps: both captures agree exactly, and the wrong words appear on well-tracked clips.

- **PLEASE and SORRY (17 wrong): a circle on the chest is not specific.** The rule accepts any open (PLEASE) or closed (SORRY) hand that makes repeated direction changes in front of the chest. Many ASL signs share that place and movement: HAPPY is PLEASE's own form with a different repetition, and BASEBALL, GYMNASTICS, PLAY and PARTY are repeated two-handed movements in the same space. The rule cannot separate them without handshape detail it does not measure.
- **THANK YOU (12 wrong): leaving the face is not specific.** Fingertips start in the mouth/chin radius and then the hand moves down and away. BAD, SAD, VOMIT, SYMBOL and DELAY all begin at or near the face and move away. The rule fires mid-movement, before the hand settles.
- **HELLO, NO, YES (4 wrong): isolated.** FUTURE and NICKEL start at the forehead and move outward, as HELLO does. FEW is a closing hand, like NO. YES has a recall problem (0/7) rather than a precision problem: WLASL YES is a smaller nod than the rule expects.
- **Synthetic vs recorded disagree on where the problem is.** Synthetically only HELLO and THANK YOU fired; on real signing PLEASE and SORRY account for half the errors. The synthetic everyday gestures contain no chest circles, so the synthetic corpus alone would have missed the larger problem.

## 2. Rule refinements under evaluation

Four opt-in refinements were added to `lib/asl-starter-recognition.ts`. All default off; `ADOPTED_STARTER_RULES` is empty, which is exactly the PR #54 rule set.

| Option | Rule |
|---|---|
| `thankYouForward` | THANK YOU must move toward the addressee (palm scale grows ≥ 1.14), not only sideways |
| `endAboveRest` | HELLO and THANK YOU must end above the resting zone (wrist above 1.25 shoulder widths below the shoulder line) |
| `helloFromForehead` | HELLO must begin at or above eye level and travel outward away from the head |
| `settledEnding` | HELLO and THANK YOU must end with a 120 ms settled hold (wrist moving ≤ 0.06) |

**Synthetic results (`RUN_STARTER_VARIANTS=1`):**

| Variant | Everyday false triggers | Positives recalled (of 51 each) |
|---|---|---|
| baseline (PR #54) | 280/684 | all 51 |
| `settledEnding` | 228 | all 51 |
| `endAboveRest + settledEnding` | 192 | all 51 |
| `helloFromForehead` | 260 | all 51 |
| `thankYouForward` | 158 | **THANK YOU 0**: the fixture has no forward motion (see §1) |
| all four | 98 | THANK YOU 0 |

**Recorded RGB, same captures replayed (wrong automatic words on 149 negatives; recall on 27 positives):**

| Variant | Wrong words (exposed / held-out) | Negative clips affected | Positives recalled | Lost positives vs PR #54 |
|---|---|---|---|---|
| **baseline (PR #54)** | 25 / 8 = **33** | 30 | **16/27** | — |
| `endAboveRest` | 24 / 8 = 32 | 30 | 15/27 | 1 (dev THANK YOU) |
| `helloFromForehead` | 25 / 8 = 33 | 30 | 16/27 | 0 |
| `settledEnding` | 18 / 6 = 24 | 23 | 15/27 | **1: the only correct THANK YOU** |
| `thankYouForward` | 18 / 6 = 24 | 23 | 15/27 | **1: the same THANK YOU** |
| all four | 16 / 5 = 21 | 21 | 15/27 | 1 |

- The refinements only reach **HELLO and THANK YOU**. THANK YOU wrong words fall from 12 to 4 (`settledEnding`), 3 (`thankYouForward`) or 1 (all four). HELLO falls from 2 to 1.
- **They do not touch the 17 PLEASE/SORRY errors**, which are half of the problem. Fixing those would need a handshape or repetition model these rules do not have. Adding one without new positive data would just be tuning to the 149 negatives.
- **Every variant that helps loses the single correctly recognised THANK YOU.** With 1 of 4 THANK YOU clips recognised at baseline, that leaves THANK YOU at 0 recall on recorded signing.
- **`settledEnding` also breaks low frame rates.** Trial adoption failed 11 existing tests: HELLO and THANK YOU no longer confirm at 3.3 fps, because a 120 ms settled hold cannot be seen with ~300 ms between frames. Stroke-boundary, temporal-stress, tail-guard and confusion-matrix tests also failed.

**Decision: no rule refinement is adopted.** `ADOPTED_STARTER_RULES` stays equal to the PR #54 rules, and the variants remain opt-in for research. The best variant cuts wrong automatic words from 33 to 21 (−36%), but it removes a sign entirely and breaks low-frame-rate use. It also still leaves 21 wrong automatic words in 149 clips. Production safety is achieved by the output policy (§3) instead. That is a transcript-safety change, **not** a recognition improvement.

## 3. Output policy (implemented)

| Source | PR #54 | This branch: production / `asl-demo` / previews | This branch: rehearsal research build |
|---|---|---|---|
| ASL starter rules | automatic | **suggestion ("Possible sign")** | automatic (`STARTER_OUTPUT=auto`) |
| ASL-2000 research model | suggestion | suggestion | suggestion |
| **BSL-1064, ISL-263, LSE-300 research models** | **automatic** | **suggestion** | suggestion |
| **PSL dictionary matcher (one-shot DTW, tagged "model")** | **automatic** | **suggestion** | suggestion |
| Personal signs, every language | automatic | automatic (unchanged) | automatic |
| Russian (Slovo), Bangla (BdSLW401) | separate component: suggestion display, never inserted or spoken | unchanged | unchanged |
| ASL fingerspelling | research only; explicit confirmation | compiled out | explicit confirmation |

- **Starter policy:** set at build time by `NEXT_PUBLIC_SIGNRELAY_STARTER_OUTPUT=auto|suggest`, resolved in `lib/release-flags.mjs`, inlined by `next.config.ts` and validated by `prepare-export`.
  - The default is `suggest`. Only the automated rehearsal profile defaults to `auto`, so automatic recognition can still be studied there and the six-sign rehearsal smoke keeps working.
  - Any build can opt in explicitly.
  - The worker bundle is identical for every profile. The policy is applied in the workspace from an inlined constant, so the committed-worker check still holds.
- **Research-model policy:** enforced in the worker for every language, with no runtime override. Proof: `tests/model-suggestion-equivalence.test.ts` runs 45 scenarios through the frozen RC worker and the current one.
  - 11 model confirmations (10 ASL, 1 BSL) become exactly 11 suggestions.
  - Unchanged: 1,576 analysis messages, 24 starter confirmations and 2 personal confirmations.
  - Model confirmations remaining after the change: 0.
- **Defence in depth:** a `confirmed` message tagged `model` (any language) is demoted to a suggestion in the workspace. The worker URL version changed to `output-policy-2`.

### Multilingual output-safety matrix

| Language | Automatic sources now | Suggestion-only sources | Independent live accuracy evidence | Covered by the shared policy? |
|---|---|---|---|---|
| ASL | personal signs; starter rules in research builds only | ASL-2000; starter rules (production) | none (ASL-2000 ≈13% accepted precision; starter rules see §1) | yes (worker and workspace) |
| BSL | personal signs | BSL-1064 | none | yes |
| ISL | personal signs | ISL-263 | none | yes |
| LSE | personal signs | LSE-300 | dataset held-out results only; live unmeasured | yes |
| PSL | personal signs | HFAD dictionary matcher | none | yes |
| RSL | none | Slovo (separate component) | none | no: a separate component that never writes to the transcript |
| BdSL | none | BdSLW401 (separate component) | publisher clips only | no: as above |
| All other languages (personal-only) | personal signs | — | n/a (user-taught) | n/a |

Confidence calibration: ASL-2000 is uncalibrated (precision stays flat at 35–37% across thresholds). Starter rules emit a fixed 0.86. No other model has a calibration study. Confidence is therefore never used to decide automatic insertion.

## 4. Confirmation workflow, accessibility and usability

- **Up to three pending suggestions, newest first.**
  - Each is armed after 600 ms, expires after 12 s, and is session-keyed and language-checked.
  - A repeated word replaces its own card.
  - A fourth arrival drops the oldest card. This is a deliberate cap to keep the panel usable on phones, and it is announced only by the card disappearing.
- **No longer withdrawn by a confirmed word.** In F1 a confirmed word withdrew the single pending card. That would now lose starter words when a personal sign confirms, so it was removed. Suggestions are still withdrawn on camera stop, worker failure or restart, a language, mode or step change, and Save & clear.
- **Signing order:** an accepted word is placed where it was signed, by its recognition time, not appended at acceptance time.
- **Provenance:**
  - Cards say **"Possible sign · not added"** (built-in sign rules, green) or **"Experimental suggestion · not added"** (named research model, amber).
  - Every transcript word carries a label: "· your sign", "· sign rules" (research builds only), "· added by you (sign rules)" or "· added by you (research model)".
  - History saves `source` and `acceptedBy`.
- **Never spoken:** suggestions are never spoken. An accepted word is spoken only if "Speak each word" is on.
- **Keyboard:** Tab to Add or Dismiss; Enter or Space activates. There are no shortcuts and focus is never moved to a new card. Focus returns to the transcript heading after a card closes, and a card that disappears while focused hands focus back to the heading.
- **Touch:** all suggestion controls are at least 44 px. With three cards at 375 px there is no horizontal overflow (smoke check 14).

### Before/after on recorded RGB (starter rules, 176 WLASL clips)

These are the same recognitions under each delivery policy. Recognition quality is identical, because the rules are unchanged.

| | PR #54 (automatic) | This branch, production (suggest) |
|---|---|---|
| **Raw recognition:** correct starter words on positives | 16/27 | 16/27 (unchanged) |
| **Raw recognition:** wrong starter words on negatives | 33 in 30/149 clips | 33 in 30/149 clips (unchanged) |
| **Transcript safety:** wrong words inserted with no decision | **33** | **0** |
| **Transcript safety:** wrong words spoken automatically ("Speak each word" on) | up to 33 | **0** |
| Correct words that need a tap | 0 | 16 |
| Wrong suggestions to ignore or dismiss | 0 | 33 |
| Research-model words (live PR #54 capture, ASL-2000) | 3 suggestions, 0 correct | unchanged |
| Time to first correct word (median / p90; dev, held-out) | 967 / 2236 ms; 934 / 1568 ms | same, plus the person's decision (minimum 600 ms arming) |

**Non-signing and unsupported signing.**

- **Synthetic everyday movements:** 280 of 684 takes inserted a wrong starter word under PR #54. They insert 0 here, and show a "Possible sign" card instead.
- **Abstention:** no rule or model fires on 119 of 149 recorded negatives. That is unchanged.

**Per-sign trade-off of a tap versus automatic insertion.** Only **NO** (6/7 precision, 6/6 recall) is a plausible candidate for automatic insertion, and seven observations are not enough to justify it. PLEASE, SORRY, HELLO and THANK YOU are wrong more often than right, so automatic insertion costs the person more corrections than the taps it saves. YES almost never fires. **No per-sign automatic list is implemented.** Under the current evidence, a tap per word is the better trade for every sign.

### Workflow checks (local, headless Chromium, synthetic camera)

`tests/model-suggestion-browser-smoke.mjs` passes 16/16. In check order:

1. A research-model card is shown and labelled. It is not inserted or spoken, and is announced as not added.
2. Activating it before the 600 ms arming does nothing.
3. Keyboard Enter adds the word once; a second click adds nothing; focus returns to the transcript.
4. Dismiss removes the card without adding or speaking.
5. A starter word is a "Possible sign" card, not inserted and not spoken.
6. A personal sign is still inserted automatically and does not withdraw pending cards.
7. An accepted word is placed in signing order.
8. Rapid successive suggestions: at most three, newest first, each armed separately.
9. A model confirmation from an older worker is demoted to a card.
10. A replaced session's suggestion is dropped.
11. Camera interruption withdraws all cards.
12. Worker failure withdraws all cards.
13. Cards expire after 12 s.
14. At 375 px with three cards there is no overflow, and every control is at least 44 px.
15. A language switch withdraws all cards, and saved history keeps provenance.
16. BSL model words are named-model cards, and the worker URL is `output-policy-2`.

A repeated word replacing its own card, stale-key rejection and double acceptance are covered by unit tests (`tests/model-suggestion.test.ts`).

The axe and transcript-a11y suites also pass on this build.

Not checked: physical touch devices, screen-reader speech output, and real-world reaction times. The owner was unavailable for webcam testing.

## 5. Verification

All runs are on the branch head unless stated.

| Check | Result |
|---|---|
| `vitest run` | **1,145 passed, 7 skipped, 0 failed** |
| `tsc --noEmit` | clean |
| ESLint | 0 errors, 1 warning (the existing unused `VisionFrame` import) |
| Model-output equivalence (45 scenarios, frozen RC worker) | 11 model confirmations → 11 suggestions; 0 left; 1,576 analysis, 24 starter and 2 personal messages identical |
| Release artifact matrix | 12/12 as expected (production, asl-demo, rehearsal, flag on/off; fingerspelling excluded from production) |
| Browser suites (21, local) | all pass: model-suggestion 16/16, production-release, workspace, landmark lifecycle, BdSL, LSE, offline vision, axe, rehearsal, fingerspelling, transcript a11y, fault injection, vocabulary scale, onboarding, demo check, lifecycle stress |
| Committed worker bundle | rebuilt and verified (`verify-runtime`); model assets and checksums unchanged |
| Starter reliability (CI, recorded RGB) | runs 41766216048 and 41767216986 pass, with identical per-clip results |
| Offline ASL Demo, Release artifact matrix, Analytics consent (CI) | pass on `ef15d3c` |
| Firebase check (CI) | every functional step passes (production isolation, F1 suggestion smoke); fails **only** at the dependency-advisory gate, which is pre-existing on #54 and not suppressed |
| Core CI | fails **only** at the same dependency-advisory gate (pre-existing, not suppressed) |
| ASL Video Pilot (CI) | fails at the PopSign download (certificate restriction, exit 78). This is known; nothing is bypassed |

No model weights, stored personal-sign formats, branding, logo, colours or supported-language infrastructure changed. Fingerspelling stays compiled out of production. There was no Firebase deployment and no merge to main.

## 6. Rollback

- **Restore automatic starter words without reverting:** build with `NEXT_PUBLIC_SIGNRELAY_STARTER_OUTPUT=auto`. This is a build-time choice; there is no runtime switch.
- **Full rollback to PR #54:** revert the three commits on this branch (the documentation commit, then `ef15d3c`, then `047f216`), or simply integrate #54 without this PR.
  - Reverting `ef15d3c` also makes BSL, ISL, LSE and PSL model words automatic again, so that path should not be used for public builds.
- **Caches:** the worker URL version (`output-policy-2`) means a rollback build must bump it again, so browsers do not keep the newer worker.
- **Stored data:** transcript history gains `source` and `acceptedBy` fields only. Older builds ignore them, and no migration is needed in either direction.

## 7. Recommendation

**Integrate this PR together with #54 for supervised testing: GO.**

- Wrong starter and research-model words no longer enter the transcript or get spoken without a person's decision, in any language.
- Personal signs are unchanged.

**Public release: NO-GO, unchanged.**

- The starter rules themselves remain low precision on real signing: 16 correct versus 33 wrong words on WLASL, with THANK YOU at 1/13 and PLEASE at 5/14. This PR makes those errors safe, not rarer.
- Other blockers remain: the #44 review and physical-device evidence (camera, touch, screen reader) with real signers.

**Owner decisions:**

1. Accept "suggest" as the production default for starter words, or keep automatic insertion. The data does not support automatic insertion for any sign; NO is the only near-candidate, and n=7 is too small.
2. Whether to fund a per-sign starter re-design, especially of the PLEASE/SORRY chest circle, evaluated on new held-out recordings rather than the exposed set.
3. Device and signer testing of the suggestion workflow.

**Independent review (self-conducted, adversarial).**

- *Is any automatic path left?* Starter and model confirmations are converted in one function (`suggestionFromMessage`) before the confirmed path; the source-review test pins that ordering. RSL and BdSL never call the transcript writer. Fingerspelling has its own explicit confirmation and is compiled out of production.
- *Could a stale card be accepted?* Keys are session-qualified; acceptance re-checks language, arming and expiry; and all cards are withdrawn on camera, worker, language, mode and step changes.
- *Is the policy truly build-time?* The resolver throws on invalid values. `prepare-export` validates the flag. `model-output-policy.ts` reads no environment, storage or URL state.
- *Residual risks:*
  - a person may tap Add on a wrong "Possible sign" out of habit; the 600 ms arming and the "not added" wording mitigate but do not prevent this;
  - the three-card cap drops the oldest card silently;
  - the starter cards' green styling is close to the accepted-word styling (they are distinguished by text, not colour alone).
