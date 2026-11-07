# Supervised signer study: protocol (ASL, alpha)

**Status: prepared, no participants yet.** Nothing in this folder is a result. Plan: [`plan-2026-11.json`](plan-2026-11.json). Privacy and consent: [`CONSENT-AND-PRIVACY.md`](CONSENT-AND-PRIVACY.md). Participant-facing guide: [`docs/alpha/SIGNER-TESTING-GUIDE.md`](../../alpha/SIGNER-TESTING-GUIDE.md).

## Why

The six ASL starter rules were measured only on synthetic movement and on licensed WLASL clips. Those clips have now been looked at, so they are no longer untouched evaluation data. The rules produced 16 correct and 33 wrong words (`docs/release-candidate/STARTER-RELIABILITY.md`). The study exists to:
- measure, with genuine signers, what SignRelay does: raw recognition, kept separate from what reaches the transcript;
- check whether the suggestion workflow is usable at real signing speed, including how often people add wrong suggestions;
- collect consented corrections that can guide the replacement recognizer (`docs/research/temporal-recognizer/`). The test is done with new signers, not the people whose corrections shaped the design.

## Design

| Element | Choice |
|---|---|
| **Signers** | 8 adult ASL users (target), at least 3 per split, with left- and right-dominant signers in each split. Deaf signers involved in wording and recruitment. |
| **Split** | Signer-disjoint, fixed at enrolment from the pseudonym and the plan's salt (`assignSplit`), before any data exists. **Development** sessions guide design. **Held-out** sessions are sealed and summarised once, for a frozen candidate. |
| **Sessions** | 2 per signer, about 25 minutes each. Session 1: camera in front at eye level, even bright light. Session 2: one of six (camera position × lighting) pairs, rotating by enrolment order, so every pair is covered across signers. |
| **Tasks (41 per session)** | <ul><li>The 6 starter signs × 3 takes (natural, slower, faster).</li><li>8 everyday movements: glasses, hair, a wave, chin, chest, drinking, typing, hands still.</li><li>10 confusable signs: HAPPY, BAD, SAD, PLAY, PARTY, COMPUTER, FOOTBALL, FUTURE, FEW, PROBLEM. These were chosen by gloss from the WLASL false-trigger analysis; new recordings only.</li><li>2 unsupported signs chosen by the facilitator.</li><li>3 rapid sequences, such as HELLO, PLEASE, THANK YOU.</li></ul>The block order is fixed and the order within each block is shuffled per signer and session. |
| **Build** | The production-profile release candidate. Fingerspelling is off and starter and research-model words are suggestions (`starter_output: "suggest"`). The private routes are included for local use only. |
| **Measures** | Per task: the first output against the expected sign (raw recognition); what entered the transcript and how (transcript safety); decisions (added, dismissed, timed out, replaced); the participant's own correction; and time to the first output. |

## Running a session

1. **Before the day:**
   - Enrol the signer. This prints the split and both sessions' conditions:
     ```bash
     node scripts/signer-study.mjs enrol evaluation/raw/signer-study/roster.json ss-2026-11-p01
     ```
   - Choose the 2 unsupported signs; they must not be in the installed vocabulary.
   - Arrange an interpreter if needed.
2. **Build and serve the session build on the facilitator's machine** (never deploy it):
   ```bash
   SIGNRELAY_INCLUDE_PRIVATE_CAPTURE=1 npm run build:firebase
   ```
   ```bash
   npm start
   ```
   Open `http://127.0.0.1:3000/study` on the facilitator’s machine. The private export binds to loopback by default and the deployment guard refuses it.

   For a phone, use a trusted private network with only authorised devices. Obtain a certificate whose subject alternative name matches the facilitator’s LAN hostname or IP, and ensure the phone trusts its issuer. Bind to the machine’s LAN IP with `npm start -- --host LAN_IP --tls-cert CERT_FILE --tls-key KEY_FILE`. Open the matching HTTPS address on the phone and check for a secure connection before starting the camera. Restrict access with the local firewall and stop the server when finished. The server requires TLS for a private export on a LAN address. Keep the certificate key outside the checkout and export.
3. **Consent:** go through `CONSENT-AND-PRIVACY.md` §2 with the participant. Tick only what they agree to, and enter the consent record reference (never a name).
4. **Set up:** enter the pseudonym (the tool shows the split), the session number, the dominant hand, the device, and the planned camera position and lighting. Then press **Start session**.
5. **In the translator below:** choose American Sign Language, start the camera and check that face, torso and hands are in view.
6. **For each task:**
   1. Read the instruction aloud or sign it.
   2. Press **Start task**.
   3. The participant signs and decides on any suggestions as they would normally.
   4. Press **Done**.
   5. The participant chooses what happened and, if wrong, what they signed.
   6. Press **Save and next**.

   **Skip task** records nothing. Do not coach the participant towards particular decisions.
7. **At the end:** if the participant agreed to sharing, download the log into `evaluation/raw/signer-study/sessions/`; otherwise press **End session and delete log**. Validate the log:
   ```bash
   node scripts/signer-study.mjs validate evaluation/raw/signer-study/roster.json evaluation/raw/signer-study/sessions/ss-2026-11-p01-session1.study.json
   ```
8. **After several development sessions:** summarise development only:
   ```bash
   node scripts/signer-study.mjs summarise evaluation/raw/signer-study/roster.json evaluation/raw/signer-study/sessions --public
   ```
   Held-out sessions refuse to summarise without `--final-heldout`. That flag is used once, for a frozen candidate, and the commit is recorded.

## Reporting rules

- **Two views:** report raw recognition (correct / wrong / no output; false outputs on everyday, confusable and unsupported tasks) separately from transcript safety (wrong words entered automatically, wrong words the participant added, wrong suggestions dismissed).
- **Small cells:** report cells only with at least 3 signers (`--public`), plus the signer and session counts, the build's `recognition_worker_sha256` and the plan id.
- **Wording:** never describe the result as "validated accuracy". It is a small supervised alpha with these signers, tasks and devices.

## What is implemented and what needs participants

| Implemented and tested here | Needs participants and the owner |
|---|---|
| The plan, the deterministic session builder and the signer-disjoint split rule | Recruitment, interpreter, Deaf community review of the tasks |
| The `/study` tool, which records nothing without consent and keeps the log in memory only, with a strict validated export | Real consent conversations and forms; a check by the owner against local law and ethics requirements |
| The facilitator CLI: enrol, withdraw, validate, summarise, sealed held-out, small-cell suppression | Real sessions and their results |
| Browser smoke on a production-profile build (`tests/study-browser-smoke.mjs`) | Device, lighting and real-signing behaviour |
