# Owner checklist — evidence that only people can provide

What this sprint could **not** establish from public data, and exactly what to collect. Nothing here needs code changes. Each item names the tool that already exists for it.

## 1. Licences and consent (before any further data use)

- [ ] Confirm in writing that the data user has accepted WLASL's **C-UDA 1.0**. The shipped checkpoint and this sprint's evaluation of publisher keypoints and direct-source test clips both rely on it. C-UDA forbids commercial use. If SignRelay is or will be commercial, the WLASL2000 checkpoint must be removed from any commercial build, whatever its accuracy.
- [ ] Record the **PopSign ASL v1.0 (CC BY 4.0)** attribution in the product credits if the landmark candidate ships: Georgia Tech Contextual Computing Group and the Deaf Professional Arts Network.
- [ ] Decide whether to request **ASL Citizen** (Microsoft Research; 2,731 signs, 52 signers) and the **Google ISLR / Kaggle "asl-signs"** landmark release (250 signs, 21 signers). Both need an account-level licence acceptance that an automated session cannot give. They are the fastest route from 250 to 500+ signs (see the scaling plan in the report).

## 2. Multi-signer live evidence (needed before any sign is called "validated" for real users)

The pipeline evidence in this report comes from publisher and phone recordings replayed in a browser. It is not live webcam use. To promote a word from "experimental" to "validated" for real users:

- [ ] Recruit **at least 5 Deaf or fluent signers** who are not SignRelay developers and were not in any training set. Get informed consent that covers landmark-only retention, using the existing local-only capture workflow (`/field-test`, `scripts/capture-intake.mjs`).
- [ ] For each word under test, have **each signer sign it 3 times** on **at least two devices** (a laptop webcam and a phone front camera), in ordinary indoor light, at a natural distance.
- [ ] Record **negative sessions per signer**: 60 seconds of conversation-like signing that contains none of the test words, 30 seconds of non-signing movement (fidgeting, scratching, reaching, waving to someone), and 30 seconds of fingerspelling. These measure false positives per minute.
- [ ] Have **one fluent reviewer who did not record the clip** confirm each label (`scripts/review-packet.mjs`).
- [ ] Freeze the cohort before evaluating anything (`scripts/freeze-evaluation-cohorts.mjs`). Never retune on it; reserve a sealed holdout as the existing cohort lock does.
- [ ] Use the acceptance rule in `training/asl2000_vocabulary_status.py`. A word is validated only if, across ≥3 unseen signers and ≥5 clips, it is correctly confirmed in ≥80% of clips, wrongly confirmed at most once, produced wrongly on ≤1% of all other clips, and confirmed with a median model latency of ≤1 s.

## 3. First 50 — the predetermined evaluation set

This set was chosen before any results and is not cherry-picked. It is the 30 everyday words in the brief plus 20 drawn from the frozen sample's tiers:

BOOK, WATER, EAT, DRINK, COMPUTER, SCHOOL, FAMILY, MOTHER, FATHER, HELP, DOCTOR, WORK, WALK, GO, COME, FRIEND, HAPPY, SAD, WHAT, WHERE, WHO, WHEN, WHY, GOOD, BAD, HOT, COLD, NEED, WANT, UNDERSTAND, CANDY, COUSIN, ALL, BLACK, NOW, BED, SHIRT, STUDY, WHITE, COLOR, ENJOY, PINK, DECIDE, FULL, LETTER, MEDICINE, RIGHT, TELL, WAIT, READ.

- [ ] Collect section 2's protocol for these 50 first.
- [ ] Report every outcome for all 50, including the words that fail. Do not replace failing words with ones that happen to work.

## 4. Devices and performance

- [ ] Measure on a low-end Android phone, a mid-range laptop without a discrete GPU, and an iPad: tracking FPS, time from the end of a sign to its confirmation, and memory. The `?perf` readout and `scripts/diagnostics/benchmark-tracking.mjs` cover this.
- [ ] Repeat on **Safari/iOS**. MediaPipe Tasks and ONNX Runtime Web behave differently there, and nothing in this sprint ran on Apple hardware.

## 5. Decisions for the owner

- [ ] **Keep or hide the WLASL2000 model.** Even after the fixes, most words it accepts on MediaPipe input are wrong (see the report). The app now labels it plainly, but hiding automatic model output until a word is validated is a reasonable product choice.
- [ ] **Adopt the landmark candidate.** Only if its unseen-signer results hold up on the live protocol in section 2.
