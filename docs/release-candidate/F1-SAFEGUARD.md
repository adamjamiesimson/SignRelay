# F1: research-model words require a person's acceptance

Stacked on release candidate `1e53d61` (PR #53). Draft PR #54, branch
`claude/charming-thompson-2aql9w-f1`.

Every result below says how it was obtained:
- **synthetic:** kinematic fixtures with a mocked model;
- **recorded RGB:** licensed WLASL clips on a CI runner;
- **local:** headless Chromium with a synthetic camera.

None of it is a physical-device or independent-signer measurement. **Manual acceptance does not make the ASL-2000 model more accurate.** It only stops the model's words from entering the transcript without a person's decision.

## 1. Root cause: how a model word became a transcript word (before)

1. `workers/recognition.worker.ts` runs three ASL sources on each frame.
   - **Personal signs** use DTW template matching in a nested worker.
   - **Starter rules** are deterministic kinematic rules for six signs.
   - **The ASL-2000 research model** (`recognizeAsl1000`) runs asynchronously, at most every 250 ms, once the motion gate is ready.
2. **Arbitration:** `direct = personal ?? starter`, then `result = direct ?? latestPrediction`. Personal and starter results always win. The model's result is used only when neither exists, and is tagged `source: "model"`.
3. **Confirmation:**
   - `shouldConfirm` requires `confidence ≥ 0.62`, two consecutive agreeing results from the **same source**, and the same-word cooldown (2.6 s).
   - The model's own gate is confidence and margin, inside `decideAsl2000`.
   - The worker then posted `{type: "confirmed", source: "model"}`, **exactly as for starter and personal words**.
4. **Workspace:**
   - `RecognitionSession` forwarded every `confirmed` message from the live session.
   - `handleWorkerMessage` appended it to the transcript and announced "Confirmed: …".
   - It spoke the word when "Speak each word" was on.

There was no point where a model-only word was treated differently. On SignRelay's MediaPipe input, about **13%** of the ASL-2000 words accepted at the production gate are correct, and precision does not improve with stricter thresholds (`docs/evaluation/asl2000-sprint8`). Raising the threshold was therefore not an option.

## 2. The safeguard (after)

| Layer | Change |
|---|---|
| Policy, `lib/model-output-policy.ts` | `SUGGEST_ONLY_MODEL_LANGUAGES = {asl}`. There is no runtime override: no message, URL, storage value or environment variable can restore automatic confirmation. |
| Worker | At the single emission point, a `source === "model"` result for a suggest-only language is posted as **`suggested`** (`id`, `language`, `text`, `gloss`, `confidence`), never `confirmed`. **Nothing else in the step changes**: cooldown, buffer clearing, invalidation and streaks are identical, so starter and personal behaviour is identical too (§3). |
| Session, `lib/recognition-session.ts` | Forwards `suggested` under the same rule as `confirmed`: live worker and live session only. |
| Workspace | One suggestion at most, held in a ref and in state. Details in the next table. |
| Defence in depth | A `confirmed` message with `source: "model"` for ASL, for example from a cached older worker, is **demoted** to a suggestion. The worker URL version changed (`?v=f1-suggestions-1`), so a cached pre-safeguard worker is never reused. |
| Saved data | An accepted word is stored with `source: "model"` and `acceptedBy: "user"`, and shown as "· added from suggestion". Main's and the RC's history validators ignore the extra field. |

How the suggestion card behaves:

| Aspect | Behaviour |
|---|---|
| Labelling | The card reads **"Experimental suggestion · not added"**, shows the word, and says "From the ASL research model, which is often wrong. Add it only if it is what you signed." |
| Actions | **Add "word"** and **Dismiss**. |
| What a suggestion never does | It is never inserted, never announced as confirmed, and **never spoken**, even with "Speak each word" on. Screen readers hear "Experimental suggestion: X. Not added to the transcript." Focus never moves to it. |
| Accepting | **Add** is inert for 600 ms after the card appears, so a tap or key press already in progress cannot accept a word not yet seen. It accepts only the suggestion on screen (the key is qualified by session), only for the selected language, and only within 12 s. Acceptance clears the suggestion, so a double activation adds nothing. There is no keyboard shortcut, only the button. |
| After accepting | The word is spoken only if "Speak each word" is on, as for any word added to the transcript, and focus returns to the transcript heading. |
| Withdrawal | A suggestion is withdrawn when: the language, mode or step changes; the camera is not active; the worker fails or restarts; the session is replaced; Save & clear runs; a newer suggestion arrives; any confirmed word arrives; or 12 s pass. Focus is preserved if it was inside the card. |

**Unchanged:** model weights, thresholds, feature extraction, starter rules and personal-sign matching. BSL, ISL, LSE and PSL model words also keep their current behaviour (§7).

## 3. Provenance and isolation: proof that only model-only ASL words changed

`tests/model-suggestion-equivalence.test.ts` (unit, synthetic) runs **45 scenarios** twice under identical deterministic model behaviour:
- once through the **frozen release-candidate worker** (`tests/fixtures/recognition-worker-rc-baseline.ts`, byte-for-byte `1e53d61`);
- once through the new worker.

The test requires the message streams to be **identical** except for one translation: an ASL `confirmed` with `source: "model"` becomes `suggested`.

The scenarios cover:
- all six starter signs, with the model silent, agreeing, or confidently wrong;
- model-only movements, repeated within and after the cooldown;
- disagreeing, low-confidence, delayed and failing inference;
- starter → model → starter sequences, and a model word followed by the same-label starter sign;
- tracking interruptions in model-only and starter signs;
- reset (cancellation) mid-sign, and switching language away and back;
- personal signs with the model silent, and with the model also predicting;
- BSL model words;
- 11 negative controls.

| Ledger (45 scenarios) | Count |
|---|---|
| Analysis messages, identical | 1,576 |
| Starter-rule confirmations, identical | 24 |
| Personal-sign confirmations, identical | 2 |
| BSL model confirmations, identical (policy not extended) | 1 |
| ASL model confirmations before | 10 |
| ASL model suggestions after | 10 |
| **ASL model confirmations after** | **0** |

A mutation check confirms the test is sensitive: routing **starter** words through the suggestion path as well fails **23** scenarios.

`tests/model-suggestion.test.ts` (11 tests) covers:
- the policy has no override;
- language scoping;
- demotion of a model `confirmed`;
- accept refused when the suggestion is stale, from another session, for another language, too soon or expired;
- no double acceptance;
- `RecognitionSession` drops suggestions from a replaced session;
- source checks that the only insert path is the Add button, with no key handler;
- every withdrawal trigger is wired.

Eleven existing worker tests that asserted an ASL model word was *confirmed* now assert it is *suggested and not confirmed*. Two research reports (`docs/gitex/sprint-3/tail-guard.json` and the confusion matrices) count emitted words. They are byte-identical, which is consistent with the equivalence proof.

## 4. Before/after: what enters the transcript automatically

### Synthetic: `docs/release-candidate/f1-synthetic-before-after.json`

The input is 1,001 synthetic takes:
- starter signs under 5 capture conditions and 36 variations (306);
- everyday non-sign movements × 36 variations (684);
- 11 negative controls.

They run through the RC worker and the F1 worker, with the model silent, confidently wrong, or agreeing with the sign.

| Model | Corpus | Takes | Correct auto words | False auto words (of which from the model) | Takes with no auto word | Suggestions after |
|---|---|---|---|---|---|---|
| silent | starter signs (all) | 306 | 306 → **306** | 0 → 0 | 0 → 0 | 0 |
| silent | everyday movements | 684 | 0 → 0 | 280 → **280** (0 → 0) | 404 → 404 | 0 |
| confidently wrong | starter signs (all) | 306 | 306 → **306** | 9 → **0** (9 → 0) | 0 → 0 | 9 (0 correct) |
| confidently wrong | everyday movements | 684 | 0 → 0 | 340 → **272** (68 → 0) | 368 → **412** | 68 (0 correct) |
| agreeing | starter signs (all) | 306 | 306 → **306** | 0 → 0 | 0 → 0 | 0 |
| any | negative controls | 11 | 0 → 0 | 4 → 4 (0 → 0) | 7 → 7 | 0 |

What this shows:
- **Positive coverage of starter signs is unchanged.**
- **Every automatic false word that came from the model is gone.** Each became a suggestion that a person can dismiss.
- **The remaining false automatic words (272–280 of 684 synthetic everyday movements, 4 of 11 negative controls) come from the starter rules, not the model.** They are identical before and after. This is an existing weakness outside F1. It is a release consideration of its own, recorded in §8.

### Recorded RGB: CI run `f1-recorded-rgb`

Run [41652817040](https://github.com/adamjamiesimson/SignRelay/actions/runs/41652817040):
- **Input:** the first 120 direct clips of the frozen Sprint 8 WLASL sample, mostly the 30 everyday signs, then frequency tiers. The everyday set contains **no** starter sign, and starter signs were excluded from the tiers when the sample was frozen. The WLASL index is hash-verified (C-UDA), and clips never leave the runner.
- **Pipeline:** both workers run through the production `VisionEngine` and `RecognitionSession` in headless Chrome on CPU.
- **Errors:** one clip failed to decode for both workers; that is a technical error, not an outcome.

| 120 clips | RC worker `1e53d61` | F1 worker |
|---|---|---|
| Automatic transcript words | 28 | **25** |
| …from the ASL-2000 model | 3 (all wrong) | **0** |
| …from starter rules | 25 (all wrong) | 25 (all wrong, unchanged) |
| Correct automatic words | 0 | 0 |
| Clips with any automatic word | 25 | **22** |
| Clips with no automatic word (abstained) | 95 | **98** |
| Suggestions offered (need a person to add them) | n/a | 3 (all 3 wrong) |

What this shows:
- **Model words:** the safeguard did exactly what it should. All 3 model-only words that the RC would have inserted automatically are now suggestions, and all 3 were wrong. That is consistent with the evaluated ≈13% precision.
- **Positive coverage:** there was no correct automatic word on these clips before or after. This sample measures false-positive behaviour, not coverage.
- **Separate, more serious finding, unchanged by F1:** the **starter rules** inserted a wrong word automatically in **25 of 120** real recorded clips of *other* signs (about 21%). This matches the synthetic result (272–280 of 684 everyday movements) and is now the main automatic-error source. It is not research-model output, so F1 does not cover it.

## 5. Production build, privacy and the existing release checks

| Check | Result |
|---|---|
| Release artifact matrix (12 configurations; local `--skip-rsl` and CI) | 12/12 as expected. The production export has the fingerspelling UI compiled out, no research models or workers, and a recognition worker matching the committed bundle |
| `production-release-smoke` (production export) | Pass |
| **`model-suggestion-browser-smoke`** (production export, real camera pipeline, controlled recognition worker; also in `firebase-build-check`) | **13/13 locally** (see the list below) |
| Existing suites (local, this branch) | All pass: workspace (transcript, speech, language switching, storage faults), landmark lifecycle, Bangla, Spanish, CDN-blocked ASL vision, axe (0 A/AA), gitex rehearsal (six starter signs confirmed automatically, abstains on three non-signs), fingerspelling (research build), transcript a11y, user-feedback faults, personal vocabulary at 30/150/300, onboarding, release flag on/off, strict offline demo, lifecycle stress, fault injection |
| Saved data | Personal-sign storage is untouched. History gains an optional field; main and RC readers accept it (the smoke checks the saved record) |
| Privacy and analytics | No new network request, storage key or permission. `analytics-consent.ts`, `firebase.json`, `vercel.json` and `next.config.ts` are unchanged from the RC |
| Unit tests | 119 files; 1,141 passed, 5 skipped (the report generator runs on demand) |

The 13 browser-smoke checks:
1. The suggestion is shown and labelled, the transcript is unchanged, nothing is spoken with auto speak on, it is announced as not added, and focus does not move.
2. A press within 600 ms is ignored.
3. Keyboard Enter adds it once, a second real click adds nothing, provenance is shown, the word is spoken once only after acceptance, and focus returns to the transcript.
4. Dismiss works.
5. A newer suggestion replaces the old one; stale and unarmed clicks add nothing; a starter word is unchanged and withdraws the suggestion while keeping focus.
6. A personal-sign word is unchanged.
7. A model-sourced `confirmed` is demoted.
8. A replaced-session suggestion is ignored.
9. Camera pause withdraws the suggestion.
10. Worker failure withdraws it.
11. 12-second expiry withdraws it.
12. On a phone (375 px), the controls are 138×44 and 105×44, with no overflow.
13. Language switch withdraws it; saved history shows `acceptedBy: "user"`.

## 6. Independent review, accessibility and mobile

**Review findings**
- **Fixed in `4e87246`.** A confirmed word cleared the suggestion inline, so focus on Add fell to the page body. It now uses the shared withdrawal, which keeps focus in the transcript. The pre-fix export fails the new smoke check.
- **Double confirmation.** Not possible: acceptance clears the ref synchronously, the next activation finds nothing, and accepted entries never go through the worker.
- **Accidental speech.** Suggestions never call `speak()`. The source test pins this, and the smoke runs with auto speak on.
- **Stale UI events.** Keys are qualified by session, an accept is checked against the ref, not the rendered props, and there is a 600 ms arming delay plus a 12 s lifetime.

**Mobile control sizes.** On touch screens (`@media (pointer: coarse)`) these now reach 44 px:
- small buttons (Speak, Stop, Copy, Save & clear, History, Take a tour, Teach a sign, record);
- transcript Edit and Remove;
- the research-notice disclosure, sliders, switch rows and the language select.

Measured at a 390 px touch viewport, controls under 44 px fell from **17 to 2**. The remaining two are switch checkboxes whose 44 px label row is the actual target. Nothing was under the 24 px AA minimum before or after. The desktop layout, the dark-green theme and the logo are unchanged.

## 7. Behaviour for the user: before and after

| | Before (RC `1e53d61`) | After (F1) |
|---|---|---|
| A word only the ASL research model recognised | Added to the transcript automatically, announced as "Confirmed", spoken if "Speak each word" was on | Shown as **"Experimental suggestion · not added"**; not added, not spoken, announced as "not added" |
| To add it | Nothing needed: it was already added | Press **Add "word"** (keyboard or touch) at least 0.6 s after it appears and within 12 s |
| To reject it | Remove it from the transcript | Press **Dismiss**, or ignore it: it is withdrawn after 12 s, on the next confirmed word, or on any camera, mode or language change |
| Starter signs (HELLO, THANK YOU, PLEASE, SORRY, YES, NO) and personal signs | Added automatically | **Unchanged** |
| BSL, ISL, LSE and PSL research-model words | Added automatically | **Unchanged.** Owner decision: adding the language to `SUGGEST_ONLY_MODEL_LANGUAGES` gives it the same safeguard |

## 8. CI, security and remaining blockers

- **CI:** see the PR #54 description for run links.
- **Dependency gate:** unchanged and **not suppressed**: 16 moderate development-only `minimatch` advisories, 0 in production. There is still no upstream fix.
- **PopSign:** still blocked by the distrusted emSign G3 chain (exit 78); not bypassed.
- **Secrets audit:** 0 findings.

**Remaining blockers for public release**
1. Owner review of #44 (product and UI).
2. **Starter-rule false confirmations.** Unchanged by F1 and not research-model output:
   - recorded RGB: a wrong automatic word in 25 of 120 real WLASL clips of other signs;
   - synthetic: about 41% of 684 everyday-movement takes produce an automatic word.

   A decision is needed before public use: for example, the same suggest-then-add flow for starter words, or tighter rules. Measurement on real devices and with independent signers is also needed.
3. Decide whether the other languages' research models get the same safeguard.
4. The owner device checklist. Any accuracy claim still needs independent signers.

## 9. Rollback

Revert `4e87246`, `4524fb5` and `36f060a`, or close PR #54.
- **Saved data:** no migration needed. Accepted entries carry one extra optional field, which older readers ignore.
- **Cached workers:** the pre-F1 worker URL returns with the revert.

## 10. Recommendation (updated)

**Supervised testing: GO**, on the production profile of this branch, with fingerspelling off. Conditions:
- Tell testers that the amber "Experimental suggestion" card comes from a research model that is usually wrong, and that it only enters the transcript if they press Add.
- Tell testers that starter-sign words can still appear on their own while signing *other* words. On recorded clips this happened in about 1 of 5 clips.
- Complete the owner device checklist first (`docs/release-candidate/README.md` §6). It now includes the suggestion card: appears, Add, Dismiss, expiry, nothing spoken.

**Public release: NO-GO.** F1 itself is resolved: research-model words can no longer enter the transcript silently. The remaining blockers:
1. Starter-rule false confirmations, measured on both recorded and synthetic input (§4, §8).
2. #44 product review.
3. Whether the other languages' research models get the same safeguard.
4. Device evidence.
