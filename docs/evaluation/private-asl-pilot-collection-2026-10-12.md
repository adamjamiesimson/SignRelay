# SignRelay — private ASL pilot collection (12 October 2026)

**Status: experimental intake tooling only; no accuracy claim and no live deployment.**

## Purpose

Gather a small **new** ASL test set so HELLO, THANK YOU and PLEASE can be reviewed independently of the previously reused PopSign evaluation clips. This is a pilot, not a representative sign-language benchmark.

- Minimum planning target: three consenting, ASL-fluent signers (**S01**, **S02**, **S03**), two separate recordings of each of the three glosses per signer (18 signed clips).
- Record at least ten separate non-sign-intent controls. Ordinary hand gestures are useful, but avoid labeling any gesture as a negative if an ASL-fluent reviewer recognizes it as meaningful signing.
- Keep both hands and the upper body in view; capture a neutral start and end, and preserve original unedited footage. Vary lighting and framing but record those conditions accurately.
- Confirm voluntary participant consent, permitted evaluation use, ability to withdraw where applicable, and ASL-fluent review of every clip. Store actual signed consent records **outside the GitHub repository**. The tool only checks your declaration, not legal validity or review quality.
- Use pseudonyms `S01`, `S02`, etc. Never put real names, faces in screenshots, phone numbers, or consent documents into GitHub issues, commits or public actions artifacts.
- Videos and the raw intake file stay in `evaluation/videos/` and `evaluation/raw/` (both ignored by git). Manifest output goes to the gitignored `evaluation/video-manifest.local.jsonl`.

## Private folder naming

Each filename must be like `s01-hello-01.mp4`, `s02-thankyou-02.webm`, `s03-please-01.mp4`, or `s01-nosign-01.mp4`. Sequence is two or three digits. Video must be local and nonempty. The script checks duplicate SHA-256 content, duplicate fixture IDs and obvious non-pseudonymous filenames. It does **not** decode or check signing quality; Chrome evaluation must do that.

Example one-line record to place in **`evaluation/raw/pilot-intake.jsonl`** (repeat as JSON Lines with distinct IDs):

```json
{"id":"pilot-s01-hello-01","signer_id":"S01","trial_type":"sign","expected_gloss":"HELLO","video":"../videos/pilot/s01-hello-01.mp4","permission_confirmed":true,"label_reviewed_by_fluent":true,"device":"phone","condition":"bright-front"}
```

Non-sign trial: use `trial_type:"no_sign"`, `expected_gloss:null`, filename like `s01-nosign-01.mp4`, and still require a fluent reviewer. Supported condition tags are `bright-front`, `dim-front`, `side-view`, `other`; devices: `phone`, `webcam`, `tablet`, `other`.

Do not mark either permission or fluent review true until actually completed. If someone withdraws permission, remove their local recordings and rerun intake/evaluation without them.

## Prepare, check, replay

From the repository root:

```bash
# Builds a partial private manifest as you add reviewed recordings:
node scripts/prepare-asl-pilot.mjs evaluation/raw/pilot-intake.jsonl

# Once complete, enforce the minimum collection count:
node scripts/prepare-asl-pilot.mjs evaluation/raw/pilot-intake.jsonl --strict

# Check local recordings before starting Chrome:
npm run eval:video -- evaluation/video-manifest.local.jsonl --preflight

# Reuse the experimental real-browser evaluator (after build:firebase):
npm run build:firebase
npm run eval:video -- evaluation/video-manifest.local.jsonl --language asl --source-frames-only \
  --output work/asl-pilot/pass-a.jsonl --report work/asl-pilot/pass-a.md
npm run eval:video -- evaluation/video-manifest.local.jsonl --language asl --source-frames-only \
  --output work/asl-pilot/pass-b.jsonl --report work/asl-pilot/pass-b.md

node scripts/compare-video-runs.mjs work/asl-pilot/pass-a.jsonl work/asl-pilot/pass-b.jsonl work/asl-pilot/repeatability.md
node scripts/report-asl-confusions.mjs work/asl-pilot/pass-a.jsonl work/asl-pilot/pass-b.jsonl work/asl-pilot/confusions.md
node scripts/diagnose-asl-tracking.mjs work/asl-pilot/pass-a.jsonl work/asl-pilot/pass-b.jsonl work/asl-pilot/tracking-triage.md
```

**Do not upload these private manifest/report files without reviewing their metadata.** Reports contain hashed footage identifiers and anonymous fixture codes but not the source videos or hand landmarks. Any participant video is potentially identifying, so never publish it without proper rights and explicit agreement.

## What this check does *not* prove

The script cannot prove that permission was lawfully obtained, labels are fluent-signer accurate, or identities/video hashes are disjoint from training and prior tuning sets. Verify signer and clip separation manually and keep an offline record. Pilot minimum counts are only collection planning gates; successful preflight/CI is not certification of translation quality or suitability for Deaf community use.

For the specific October 12 failure, the repeated false PLEASE on one HELLO clip was confirmed to originate in the **starter-rule** path rather than the research model. High hand-frame coverage in that case means a tracking drop is *not* an adequate explanation. A rule change should only be accepted after it performs better on new signer-verified clips without increasing false accepts.
