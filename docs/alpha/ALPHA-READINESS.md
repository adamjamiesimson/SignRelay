# Recognition validation and supervised alpha preparation

> **Draft:** sections marked with UPPER_CASE placeholders are filled in once the final verification and CI runs complete.

Stacked on PR #55 (`6674c90`). Draft PR #56, branch `claude/charming-thompson-2aql9w-alpha`. Nothing merged or deployed.

**Owner decisions applied:**
- `suggest` stays the production default for starter words.
- Unvalidated model words stay suggestion-only.
- Personal signs are unchanged.
- There is no production auto-confirmation.
- No further tuning against exposed WLASL clips.
- A path toward reliable recognition is prepared.

**How results were obtained:** unit tests; built exports in headless Chromium with a synthetic camera and a controlled recognition worker; and CI. **No participant has used any of this.** Nothing here is a measurement of real signing accuracy.

## 1. Suggestion experience (P0)

### Audit findings on PR #55

| # | Finding | Severity | Evidence |
|---|---|---|---|
| 1 | **An accepted word is placed at the end of the transcript, not where it was signed.** Confirmed words carry the camera frame clock (`performance.now()`-based, from `lib/live-vision.ts`), but accepted words were timed with `Date.now()`. Every accepted word therefore compared as "latest". PR #55's smoke test missed it because it injected `Date.now()` timestamps. | bug | code inspection; now covered by a unit test and by smoke check 7 using frame-clock timestamps |
| 2 | **A fourth suggestion silently dropped the oldest card.** | usability / safety | PR #55 smoke check 8 |
| 3 | **Newest-first ordering moved every card down when a word arrived,** so a tap aimed at a card could land on a different word. Answering a card moved the next one up under the finger, so a double tap could add it. | habitual mis-acceptance | reproduced in the browser (check 8b) |
| 4 | **12 s expiry could not be paused or extended** (WCAG 2.2.1 Timing Adjustable), including while the person was reading or pointing at the card. | a11y | |
| 5 | **A repeated word replaced its card and moved it to the top.** | clutter / shift | |
| 6 | **Each card repeated a long explanatory paragraph.** With three cards this crowded the panel on a phone. | clutter | |
| 7 | **Starter cards had a filled green background,** close to the accepted-word styling. | possible vs. accepted confusion | PR #55 review |
| 8 | **An early press of Add did nothing, with no feedback.** | screen-reader usability | |

### Changes (`lib/model-suggestion.ts`, workspace)

- **Signing order, stable positions.**
  - Cards appear oldest first and new cards are added below, so nothing moves when a word arrives.
  - An accepted word keeps the worker's recognition time and is inserted on the transcript's own clock (fix for 1).
- **Re-arm on movement.** Any card whose position changes (another answered, expired or replaced) ignores activation for 600 ms. A double tap cannot add the card that slid into place (fixes 3).
- **No silent loss.**
  - When three cards are shown and nobody is interacting, a new word replaces the oldest. The replaced word is listed under **Not added: …** and announced.
  - Timed-out words are listed and announced as well.
  - The list holds at most 3 words, fades after 20 s, and its words cannot be added (fixes 2).
- **Timing adjustable.**
  - While the pointer or keyboard focus is in the suggestions, nothing expires, and new words wait ("1 more waiting") instead of pushing a card away.
  - On leaving, every card keeps at least 4 s (fixes 4).
- **Repeats** are counted on the word's own card ("Recognised 2 times"), in place, without moving it or re-arming it (fixes 5).
- **Less clutter.**
  - One shared line, "Not in the transcript. Add a word only if it is what you signed.", replaces a paragraph per card.
  - Card labels name the source: "Possible sign · built-in sign rules" or "Experimental suggestion · ASL research model" (fixes 6).
- **Possible vs. accepted.** Pending starter words are dashed outlines with no fill. Transcript words keep their labels: "· your sign", "· added by you (sign rules)", "· added by you (research model)" (fixes 7).
- **Screen readers.**
  - An early press announces "Not added yet. Check the word, then press Add again."
  - Each new card, repeat, wait, replacement and timeout has its own polite announcement (fixes 8).
- **Kept from PR #55:**
  - deliberate acceptance;
  - stale-result protection (session keys; language, camera, worker, mode and step withdrawal);
  - no speech for suggestions;
  - unchanged personal signs;
  - no keyboard shortcuts and no focus theft;
  - 44 px targets;
  - the dark-green design and the logo.

**Habitual acceptance cannot be solved in software.** The changes remove the mechanical causes (tap targets moving, double taps, timing pressure). Whether people still add wrong words by habit is now measured by the signer study as "wrong words the participant added" (§3).

### Verification

- Unit tests: `tests/model-suggestion.test.ts`, 23 tests including a rapid-signing suite.
- Browser: `tests/model-suggestion-browser-smoke.mjs`, **19/19 on the production export**. It uses real pointer input for taps and hovering, and frame-clock timestamps.

## 2. Production output policy (P1)

**Audit of the build and deploy paths on PR #55:**

| Path | PR #55 | Gap |
|---|---|---|
| `npm run build:firebase` | `prepare-export` validates the flag; `next.config.ts` inlines it | `NEXT_PUBLIC_SIGNRELAY_STARTER_OUTPUT=auto` was accepted in a production build |
| Vercel (git integration; `vercel.json` build command) | **No `prepare-export` step** | `auto` from a Vercel environment variable would ship automatic starter words on a production or preview URL |
| `.env*` files | fingerspelling flag rejected | the starter flag and `SIGNRELAY_RESEARCH_EXPORT` were not rejected |
| `scripts/deploy-firebase.sh` | refused only the private capture route | nothing checked the starter policy, research exports or fingerspelling in the artifact |
| Runtime | constant inlined at build time | a research export uploaded by mistake would insert words automatically |
| GitHub Actions | none deploy | none |

**Changes:**
- **Fail closed at resolution** (`lib/release-flags.mjs`). `auto` is accepted only in a non-public research export: the rehearsal profile, or `SIGNRELAY_RESEARCH_EXPORT=1` together with the flag. It is refused on every Vercel build (production or preview, acknowledged or not), in `asl-demo` and in `full`. Because `next.config.ts` resolves it, every build path is covered, including Vercel.
- **`.env` files** may not set either research switch.
- **Marked research exports.** `prune-research.mjs`, which runs in every path including Vercel, writes `.signrelay-research-export` with the reasons. The client shows "Research build: sign-rule words are added automatically. Not for public use."
- **Artifact checks.**
  - The runtime manifest records `starter_output`.
  - `verify-runtime` compares it with the compiled client, by looking for the banner literal; that branch is dropped from suggest builds.
  - `scripts/assert-public-export.mjs` refuses research markers, private routes, non-production profiles, `starter_output ≠ suggest`, fingerspelling, the rehearsal hook, and compiled auto or fingerspelling UI. `deploy-firebase.sh` runs it before deploying.
- **Browser guard.** A research export opened from a public host (anything other than this device, a `.local` name or a private network address) falls back to suggestions, and its banner says so. Until the host is known, the policy is `suggest`.

**Verification:**
- **Release artifact matrix: MATRIX_RESULT.** The six new rows:
  - unacknowledged `auto` → refused;
  - `.env` `auto` → refused;
  - acknowledged research export → automatic, marked, banner compiled, refused by the gate;
  - Vercel production `auto` → refused;
  - Vercel preview `auto` with acknowledgement → refused;
  - `asl-demo` `auto` → refused.

  Production rows pass the public gate with no problems.
- **Browser** (`tests/starter-policy-browser-smoke.mjs`):
  - research export on 127.0.0.1: starter word inserted automatically and labelled "sign rules";
  - the same files from `signrelay-public.test`: suggestion, with the fallback banner;
  - production export: suggestion on both hosts, no banner;
  - personal signs automatic in all cases.
- **Research workflows preserved.** The rehearsal profile still inserts starter words automatically, and the rehearsal smoke passes (§5).

## 3. Supervised signer study (P2): implemented, needs participants

Files: `docs/evaluation/signer-study/` (plan, protocol, consent and privacy specification), `lib/signer-study.ts`, `app/study/` (private route), `scripts/signer-study.mjs`, and the participant guide `docs/alpha/SIGNER-TESTING-GUIDE.md`.

**Tasks (41 per session, 2 sessions per signer):**
- the six starter signs ×3 paces;
- 8 everyday movements;
- 10 confusable signs (HAPPY, BAD, SAD, PLAY, PARTY, COMPUTER, FOOTBALL, FUTURE, FEW, PROBLEM), chosen by gloss from the WLASL false-trigger analysis, with new recordings only;
- 2 unsupported signs;
- 3 rapid sequences.

**Conditions:**
- left- and right-dominant signers in each split;
- 3 camera positions × 3 lighting conditions, rotated across signers;
- device class recorded.

**Split:** signer-disjoint, fixed at enrolment from the pseudonym (salted SHA-256 parity) before any data exists. Held-out sessions are sealed: the CLI refuses to summarise them without `--final-heldout`.

**Consent:**
- Granular and opt-in, with every box unticked by default.
- Nothing is recorded without participation consent, logging consent and a consent-record reference.
- Download requires sharing consent.
- Withdrawal is supported.
- Video for training is a separate, separately licensed activity (`/field-test`).

**Privacy:**
- The study log holds no video, image, landmark, audio, name, device label, free text or absolute time.
- Personal-sign words are exported only as `PERSONAL`.
- The log lives in memory only and is never uploaded.
- The validator refuses any undocumented field.
- Public summaries suppress cells from fewer than 3 signers.

**Measures:** raw recognition (first output vs. expected; false outputs on negatives) **separately from** transcript safety (wrong words entered automatically, wrong words the participant added, wrong suggestions dismissed, correct words lost to timeout or replacement). Also latency and the participant's own corrections.

**Verification:**
- Unit tests: `tests/signer-study.test.ts`, 23.
- Browser: `tests/study-browser-smoke.mjs`, 6 checks, on a production-profile build with private routes:
  - consent gate and axe clean;
  - no recording outside a task window;
  - correct addition scored correct;
  - wrong addition counted as habitual acceptance;
  - downloaded log validates, with no personal-sign text;
  - nothing in local or session storage, no POST or beacon;
  - deleted and consent reset at the end.
- The route is excluded from public exports, and the deploy gate refuses an export that contains it.

**Needs the owner and participants:**
- recruitment;
- interpreter;
- Deaf community review of the tasks;
- a legal and ethics check of the consent text;
- the sessions themselves.

## 4. Replacement recognizer research (P3): infrastructure, no claim

See `docs/research/temporal-recognizer/DIRECTION.md`.

**Direction:**
- **Stop extending the rules.** PR #55 showed that tightening them trades one error for another.
- **Use a transparent DTW baseline (option B)** over body-relative features to build the evaluation discipline: signer-disjoint folds, exposure tracking, rejection against real negatives.
- **Collect consented data** through the study and `/field-test`.
- **Move to a small temporal network (C)**, or a fine-tuned skeleton backbone (D), only when untouched held-out signers can be evaluated.

**Implemented:**
- `lib/sign-features.ts`: handshape, location, motion and two-hand channels; mirroring; segmentation; repetition.
- `lib/temporal-baseline.ts`: configuration fixed before any data; rejection calibrated on training signers only.
- `lib/temporal-experiment.ts` and `lib/temporal-predictors.ts`: rules and baseline on the same folds; exposure reported separately.
- The CLI, with synthetic, WLASL and JSONL modes.
- CI: WLASL signer ids are recorded on the runner, and the experiment runs on the captured landmarks.

**Results:**
- **Synthetic, a pipeline check only:**
  - rules: 60/60 targets, 20/55 everyday movements accepted;
  - baseline: 53/60, 7 abstained, 0/55 accepted.

  The rules were written for these fixtures, so this says nothing about real signing.
- **WLASL (CI, every clip exposed, development estimate only):** WLASL_RESULT

## 5. Alpha release candidate (P4)

**Candidate:** the production profile (`full`), fingerspelling off, starter and research-model words as suggestions.

**Verification on the final commit:**

VERIFICATION_TABLE

**Signer guide:** `docs/alpha/SIGNER-TESTING-GUIDE.md`. It covers what to expect, the exact tasks, how to decide about cards, how to report wrong predictions, and withdrawal.

**Stored data:**
- Transcript history: unchanged schema. Accepted words keep their `source` and `acceptedBy`, and their `timestamp` is now the recognition time on the transcript clock. Older entries load unchanged.
- Personal-sign templates, calibration and settings: untouched.
- The study log is never stored.

## 6. Implemented vs. needs participants

| Implemented and verified here | Requires participants or the owner |
|---|---|
| Suggestion workflow fixes; 19 browser checks | Whether real signers keep up with the cards at signing speed, and how often they add wrong words |
| Fail-closed starter policy across every build path; artifact gate; browser host guard | The owner keeping Vercel environment variables free of research switches. They are refused anyway. |
| Study plan, protocol, consent spec, `/study` tool, CLI, guide | Recruitment, consent conversations, legal and ethics review, sessions |
| Research features, baseline and signer-disjoint framework, with a CI run on exposed WLASL clips | Untouched data; training a real candidate; the sealed held-out comparison |

## 7. Rollback

- **This PR as a whole:** revert its commits, or integrate only #54 + #55. Nothing in it changes stored data formats or model assets.
- **Suggestion workflow only:** revert `ec36ad3`'s `lib/model-suggestion.ts`, workspace and CSS changes together. The P1 policy in the same commit is independent of them, but reverting the whole commit is simplest.
- **Study tool:** delete `app/study/` and remove `"study"` from `PRIVATE_ROUTES`. It is not in public exports anyway.
- **Research modules:** they are unused by the app and can be removed freely.

## 8. Recommendation

RECOMMENDATION
