# Paired ASL confusion diagnostics (experimental)

This is a **metadata-only** report for the work already being done in draft recognition PR #17. It requires two JSONL outputs from the *same video fixtures*, as emitted by PR #17's browser video evaluation runner. It does not change the sign recognizer, weights, thresholds, deployed app, or camera capture.

## Run

After completing two browser replays with the evaluator in PR #17:

    node scripts/report-asl-confusions.mjs \
      work/popsign/pass-a/results.jsonl \
      work/popsign/pass-b/results.jsonl \
      work/popsign/confusions.md

The input files are expected to contain ASL-only records with a SHA-256 fingerprint in each row's notes and pseudonymous participant IDs. PopSign and Commons fixture preparation in PR #17 already writes fingerprints. This script produces a single Markdown report and does not open or upload video.

## What it reports

- Counts for HELLO, THANK YOU and PLEASE, plus any additional observed target glosses
- Correct recognition, rejection, wrong accepted labels, additional predictions, timeouts and errors per run
- HELLO→THANK YOU, THANK YOU→PLEASE, and other actual accepted-sign confusions
- Non-sign-intent false accepts in both runs
- Mean recorded hand-tracking coverage by gloss
- Predictions that vary between two replays

The comparison **rejects** duplicate source hashes, mismatched fixture IDs, signer identity, source fingerprint, frame modes or recording conditions. It also rejects inconsistent claims of "correct" and inconsistent negative outcomes.

## Interpretation and follow-up

The historical 10-sign / 2-negative PopSign smoke set was already used to guide tuning. Even a clean run would not demonstrate signer-independent accuracy. Suggested **collection planning** floors (not certification thresholds) are six clips from at least three identified signers for each of the three target glosses and ten non-sign-intent clips. A much larger frozen, independently reviewed, signer-separated set is required to make meaningful release claims.

Do not read a passing CI job as improved recognition accuracy. The next physical-data task is to collect fresh, consented or licensed signer-confirmed recordings under varied lighting and devices, with separate identities and source hashes from training and tuning. This comparator alone **cannot prove** no overlap with the model's training set, and does not assess sign-language grammar or real-world sentence translation.

The report contains neither videos nor landmarks. Use anonymized fixture IDs and avoid putting signer names or sensitive metadata in filenames or notes.

## Rollback

The report is isolated to the evaluation layer. Remove this script, its unit tests and this documentation if not adopted; no user-facing behavior or model weights are affected.
