# Signer study: privacy and consent specification

Plan: [`plan-2026-11.json`](plan-2026-11.json). Consent text version: `signer-study-consent-2026-11-v1`, the `CONSENT_VERSION` in `lib/signer-study.ts`.

This specification sets what may be collected, and how, before any participant takes part. It is not legal advice. The owner must check it against the laws that apply where sessions take place (for example UK GDPR/GDPR or US state privacy law), and must obtain ethics review where the owner's organisation or a partner requires it.

## 1. What is collected, by activity

| Activity | Tool | Collected | Never collected |
|---|---|---|---|
| **A. Supervised translator session** (this study) | `/study` (private route, local build only) | Pseudonym, session number, the enrolment split, dominant hand, camera position, lighting, device class and camera resolution. Per task: the task id, SignRelay's outputs (gloss, source, how delivered) and the participant's decisions (added, dismissed, timed out, replaced, removed). Also the participant's selected correction (an outcome from a fixed list, optionally a gloss from the plan's list), with times in ms relative to the session start. | Video, images, hand/face/body landmarks, audio, names, contact details, device names or identifiers, IP addresses, absolute timestamps, free text. Personal-sign words, which are user-chosen text, are exported only as `PERSONAL`. |
| **B. Development recording** (separate, optional) | `/field-test` (existing private route) | Original video takes plus a sidecar (pseudonym, slot, hands, device class, SHA-256, camera settings). | Names, device labels. |
| **C. Anonymous quotation** (optional) | facilitator notes | Short paraphrased feedback with no identifying detail. | Anything that identifies the person. |

**Activity A is the alpha study.** It needs no biometric data at all. Activity B is a different decision for the participant and is never bundled with A. Video and landmarks are biometric and identifying, so B exists only for future training and development, under its own consent and licence.

## 2. Consent: explicit, granular, opt-in

Consent is given before the session, in the participant's preferred language. That may be ASL through a qualified interpreter, or a signed or captioned video of this text. Each item is a separate yes or no, every box starts unticked, and saying no to an optional item has no consequence.

| Item | Required for | Default | Recorded as |
|---|---|---|---|
| 1. I am 18 or over and agree to take part in a supervised session using SignRelay's live translator. | A | no | `participate` |
| 2. I agree that a local study log is kept during my session, containing SignRelay's outputs, my decisions and my corrections, but no video, images, landmarks or my name. | A (to record anything) | no | `keepLog` |
| 3. I agree that the facilitator may download that log and share it privately with the SignRelay team for evaluation. | export of A | no | `share` |
| 4. I agree to separate video recording for developing SignRelay, under the Research Recording Licence (§4). | B only | no | separate B record |
| 5. I agree that my anonymous comments may be paraphrased in reports. | C only | no | separate C record |

**How the tool enforces this (`lib/signer-study.ts`):**
- Nothing is recorded unless items 1 and 2 are given and a private consent reference is entered (`canRecord`).
- The log can be downloaded only with item 3 as well (`canExport`).
- The validator refuses any export without all three, or with any undocumented field (`validateStudySession`).

**Withdrawal.** A participant may stop at any time, or withdraw afterwards, without giving a reason.
- **During a session:** "End session and delete log" discards everything in the browser.
- **Afterwards:** the facilitator adds the pseudonym to the private withdrawal list. All of that signer's records are deleted within 30 days and excluded from every later summary.
- **Results already reported in aggregate** cannot be recalled, and the consent text says so.

## 3. Pseudonyms and records

- **Pseudonyms:** `ss-2026-11-pNN`, assigned at enrolment by the facilitator.
- **The roster:** the mapping from pseudonym to person, together with the signed consent forms, is kept only in the owner's private records. That is outside the repository, or in the ignored `evaluation/raw/` folder on an encrypted device. It is never committed, uploaded to CI, or sent to anyone who does not need it.
- **`consent_ref`:** an opaque reference to the private consent record, such as `c-0007`, never a name.
- **Split:** fixed at enrolment by the rule in the plan and recorded in the roster (`node scripts/signer-study.mjs enrol`). The split is a function of the pseudonym only, and is computed before any of the person's data exists.
- **Deaf community involvement:** recruitment, task wording and the interpretation of results should involve Deaf ASL users. The plan's confusable and everyday lists are a starting point for them to revise, not a fixed instrument.

## 4. Research Recording Licence (activity B only; summary)

- **Use:** internal evaluation and development of SignRelay's recognizers. That includes training models whose weights may be distributed. Recordings themselves are never redistributed, published or shown publicly.
- **Storage:** encrypted storage controlled by the owner. Recordings are never committed to GitHub, never put in a public CI artifact, and never uploaded to a third-party service.
- **CI:** recordings may be processed in CI only on a private runner or in a job whose logs and artifacts contain aggregate counts alone. This is the pattern the WLASL workflows use.
- **Retention:** 24 months from recording, unless the participant renews, and deletion within 30 days of withdrawal.
- **Credit:** participants are not named unless they ask to be credited by name, in writing.

## 5. Data handling rules for the study log (activity A)

1. The study log lives only in the browser tab's memory. It is not written to `localStorage` or `IndexedDB`, and it is not sent over the network. Reloading or closing the tab discards it.
2. "Download study log" creates a JSON file on the facilitator's device. That file goes only into ignored `evaluation/raw/signer-study/` or private storage, and travels only through a private channel.
3. `node scripts/signer-study.mjs validate <file>` checks a log before it is kept:
   - schema and consent;
   - no extra fields;
   - pseudonyms only;
   - relative times only;
   - glosses only from the vocabulary;
   - task ids that match the participant's own session plan;
   - the split matches the roster.
4. `node scripts/signer-study.mjs summarise <dir>` reports **development** sessions only. Held-out sessions are sealed: they are summarised once, for a frozen candidate, with `--final-heldout`.
5. Public reports contain only aggregate counts by split, task kind and gloss, and only when every cell comes from at least three signers. Smaller cells are reported as "fewer than 3 signers".

## 6. What this study can and cannot claim

- **Can:** with real participants, the study can measure how often SignRelay produces the right or wrong word for these tasks, under these conditions, for these signers. That includes how often people add wrong suggestions.
- **Cannot:** before sessions take place, nothing may be cited as evidence. Even afterwards, a small study does not establish general accuracy, fairness across signers, or performance for other signs, dialects or devices.
