# Independent fluent ASL review — coordinator and reviewer guide

**Status (21 October 2026): workflow built and tested with synthetic data only. No reviewer has been recruited, no recording has been reviewed, and no participant consent has been collected by this sprint.** Real-world validity remains blocked on people, not code.

## Roles

| Role | Sees | Never sees |
| --- | --- | --- |
| Coordinator (project owner) | Private intake, consent references, coordinator key | — |
| Independent fluent ASL reviewer | `review-packet.json` and `media/R-*.webm/mp4` | Trial IDs, requested gloss, trial type, participant pseudonyms, consent records, model predictions, logs or evaluation reports |
| Participant | Their own recordings | Other participants, review results before the freeze |

The reviewer must be fluent in ASL, independent of every participant (not a participant, not reviewing their own signing), and must not have seen SignRelay predictions for these takes. A checkbox or self-declaration in a JSON file is a record of the attestation, **not** proof. The coordinator keeps the evidence (for example a signed reviewer agreement) privately, outside Git.

## Steps

1. Capture with `/field-test`, then import with `scripts/capture-intake.mjs` (see `docs/evaluation/reviewed-development-collection-2026-10-17.md`).
2. Build a blind packet (all paths are Git-ignored):
   ```bash
   node scripts/review-packet.mjs packet evaluation/raw/asl-development-2026-10-17/intake.json evaluation/raw/review-batch-1
   ```
   Give the reviewer only `review-packet.json` and `media/`, through a private channel. Keep `coordinator-key.json`.
3. For each item, the reviewer fills in:
   - `usable`: `false` if hands/face/torso are not adequately visible, the take is cut off, or it cannot be judged. Then give `unusable_reason`.
   - `actual_sign`: the observed ASL gloss, or `NO_SIGN`.
   - `variant_notes`: the variant, handshape or movement used (required for usable takes).
   - `stroke_start_s` / `stroke_end_s`: the sign stroke within the file, in seconds (required for signs).
   - Reviewer header: pseudonymous `reviewer_id`, `fluent_asl`, `independent_of_participants`, `blinded_to_predictions`, `reviewed_on`.
4. Merge:
   ```bash
   node scripts/review-packet.mjs merge evaluation/raw/asl-development-2026-10-17/intake.json \
     evaluation/raw/review-batch-1/coordinator-key.json evaluation/raw/review-batch-1/response.json \
     docs/evaluation/development-collection-plan-2026-10-17.json
   ```
   A take is **approved** only when the reviewer's own label matches what was planned (a planned sign, `NO_SIGN` for a no-sign activity, or any sign for an unsupported-sign slot). A mismatch is stored as `rejected` / `label-differs-from-plan` and never coerced into the requested gloss. Merging refuses missing attestations, reviewers who are participants, stroke intervals outside the recording, recordings changed since the packet was made, and trials that already have a decision.
5. Fill `consent_reference`, `recording_group`, `source` and `license` privately, then freeze with `prepare-reviewed-development.mjs freeze` (which re-checks every rule and the capture checksum).

## Consent and identity protection

- Consent forms, names and contact details never enter the repository or the intake JSON; the intake holds only a private `consent_reference` pseudonym.
- Video shows faces. Treat `evaluation/videos/` and every review batch as sensitive personal data. Delete review copies after the merge.
- Minors require guardian consent according to the venue's and the school's rules.
- Withdrawal: delete the participant's media, review copies and intake rows. Reviewed manifests are only frozen after the batch is complete.
