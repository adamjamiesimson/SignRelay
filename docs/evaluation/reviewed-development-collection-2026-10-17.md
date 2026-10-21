# Reviewed ASL development collection, 17 October 2026

The [video-frame follow-up](video-frame-reliability-2026-10-17.md) bounds file loading, waits for seek completion and presentation, preserves interrupted observations and marks early camera stops as errors. It prevents overlapping diagnostic trials. It does not supply participant recordings or reviews.

This packet prepares the next development batch. **Zero new participant recordings and zero fluent-signer reviews have been collected.** The 144 slots below are a collection target, not measured results, release thresholds or a statistical power calculation. The five reserved PopSign holdout clips remain sealed.

| Four new development participants | Takes per participant | Planned total |
| --- | ---: | ---: |
| HELLO, THANK YOU, PLEASE, SORRY, YES and NO; three comfortable signing speeds | 18 | 72 |
| Six ordinary/non-sign activities; two independent takes each | 12 | 48 |
| Three reviewer-selected unsupported signs; two takes each | 6 | 24 |
| Total | 36 | 144 |

Recruit separately from the existing reserved participants, including at least one naturally left-dominant and one naturally right-dominant signer. Record actual physical hand use; do not mirror footage to manufacture handedness coverage. Keep each original continuous recording at most 30 seconds and 100 MB. Use the normal dominant hand, keep the face/torso/hands visible, and include a short natural lead-in and ending. Do not add pauses or duplicate, crop, mirror or re-encode frames for scoring. Keep challenging takes in the denominator; do not discard a reviewed valid take because recognition misses it.

Ordinary activities are idle hands, conversational gestures, adjusting clothing/glasses, resting and moving a hand near the chest, a non-sign incomplete circular sweep, and camera repositioning. A fluent reviewer must confirm these are genuinely non-sign activities. Unsupported-sign slots require three distinct real ASL glosses absent from the installed ASL-2000 **and** starter vocabulary. A supported alternate sign is not an unknown-sign negative.

An independent fluent ASL reviewer identifies the actual gloss, variant and activity before viewing predictions. For each take record the pseudonymous reviewer ID, review date, approval/rejection, variant notes, actual device and physical hands. Note the articulation onset/ending in variant notes when possible; this will let future tracking analysis distinguish a missed stroke from a valid pause. Keep the participant identity mapping, consent forms, rejected-take history and original footage private. Public metadata contains only pseudonyms and references to those private records. The tooling verifies complete attestations and consistency; it cannot establish a person's fluency, consent or independence itself. No reviewer was contacted by this work.

## Prepare the private review queue

From the repository root, with Node 22.13+ and Git:

```sh
node scripts/prepare-reviewed-development.mjs template \
  docs/evaluation/development-collection-plan-2026-10-17.json \
  evaluation/raw/reviewed-development-2026-10-17/intake.json
```

This creates 144 pending rows, with no invented hashes, approvals or observations. It refuses to overwrite an existing intake. Complete `participants[].dominant_hand` from actual participants and every trial's source/license, consent reference, unique recording group, device, physical hands, original-take declaration and independent review. Place original videos at the listed ignored `evaluation/videos/...` paths. A rejected or pending row prevents the complete batch from being frozen. Retakes and any plan revisions must be recorded before inspecting predictions.

## Freeze only after recording and human review

Install `ffprobe` as well, then use two new metadata paths:

```sh
node scripts/prepare-reviewed-development.mjs freeze \
  docs/evaluation/development-collection-plan-2026-10-17.json \
  evaluation/raw/reviewed-development-2026-10-17/intake.json \
  docs/evaluation/asl-reviewed-development-2026-10-17.json \
  docs/evaluation/cohort-lock-reviewed-2026-10-17.json
```

The importer rejects incomplete review before opening recordings; checks reserved participant aliases and recording groups; requires ignored media paths; rejects symlinks outside the media directory, duplicate bytes, missing/invalid video and excessive size/duration; computes SHA-256 fingerprints; and validates all original cohort separation rules. It writes a new manifest and an extended lock with exclusive creation. It preserves every original manifest, its role, fingerprint, count and vocabulary snapshot. It never runs recognition or overwrites the original lock. Review the public pseudonymous metadata before committing it; never stage the intake, consent forms, footage or landmarks.

## Replay the reviewed development batch

```sh
npm run build:firebase
node scripts/prepare-recognition-lab.mjs
node scripts/run-recognition-video-evaluation.mjs /path/to/chrome \
  docs/evaluation/asl-reviewed-development-2026-10-17.json \
  evaluation/derived/reviewed-development-first-pass.jsonl \
  --cohort-lock=docs/evaluation/cohort-lock-reviewed-2026-10-17.json
```

Use `--fetch-assets-via-node` only for the existing fixed official-runtime forwarding case. The loader rechecks the collection-plan fingerprint, complete coverage, fluent-review metadata, OOV vocabulary and preservation of all original cohorts before replay. Default evaluation retains no landmarks. Do not use `--final-holdout` for this development collection.

Report every take, per-sign recall, wrong words, abstentions, runtime errors, actual no-sign/OOV false-accept denominators and hand-tracking coverage. Until real negative recordings have completed, their rates remain null. The existing live-camera lab can subsequently test actual phones, but this file does not certify physical-device performance or authorize release.

An interrupted trial retains observed confirmed words and partial counters when identity matches. Missing browser evidence uses null counters; it does not establish a successful rejection. Incomplete negative cohorts keep false-acceptance rates null even when an observed false acceptance is retained.

The importer was exercised locally with six clearly marked generated-video controls, including metadata freezing, round-trip loading, unique hashes, original-cohort preservation and overwrite refusal. No recognition was run on those generated files, and they contribute no signing or negative-trial evidence. [Technical control result](asl-miss-diagnosis-2026-10-17/import-smoke.json).

## Importing `/field-test` downloads (21 October 2026)

1. Create the private intake once: `node scripts/prepare-reviewed-development.mjs template docs/evaluation/development-collection-plan-2026-10-17.json evaluation/raw/asl-development-2026-10-17/intake.json`.
2. Move each downloaded `TRIAL.webm|mp4` and its `TRIAL.capture.json` into `evaluation/videos/asl-development-2026-10-17/` (Git-ignored).
3. Run `node scripts/capture-intake.mjs docs/evaluation/development-collection-plan-2026-10-17.json evaluation/raw/asl-development-2026-10-17/intake.json evaluation/videos/asl-development-2026-10-17`.

The importer is all-or-nothing. It fails when:
- a sidecar names a trial outside the 144 planned slots, or its participant, type, expected gloss or split differ from the plan;
- the sidecar claims any review status;
- the file name differs from the trial ID, or the extension, MIME type and actual container bytes (WebM EBML / MP4 `ftyp`) disagree;
- the size or SHA-256 differ from the values computed at capture;
- the duration is outside 1–30 s, or the dominant hand, physical hands or device are missing;
- one recording is reused for two trials, a participant's dominant hand contradicts an earlier take, an imported trial would be silently replaced, or a trial already holds a review decision.

The importer replaces the template's placeholder `.mp4` path with the real file and records `capture.sha256`. Freezing then refuses a recording whose bytes changed after capture. It never fills `consent_reference`, `recording_group`, `source`, `license` or any review field; its report counts what is still required. Schema-1 sidecars (no checksum) import with `original_unmodified_take: false`.
