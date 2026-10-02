# Recognition hardening — 2026-10-02

This note records the reliability work layered on top of the pretrained-language and automated-video-evaluation branches. The goal is not to inflate vocabulary counts; it is to make every accepted transcript word easier to trust and every evaluation result reproducible.

## What changed

### 1. One physical sign, one transcript event

The recognition worker now uses an inter-sign re-arm gate. After a word is confirmed, another automatic word cannot be emitted until the camera stream has spent a short continuous interval in an idle or hands-absent state. Renewed movement resets that interval.

This addresses a specific isolated-sign failure mode: the tail of one physical movement can move through a second closed-set class and otherwise produce an extra accepted word. Confidence alone is not sufficient evidence that the second class is a new sign.

The gate is deliberately short (260 ms) and the translator already instructs the signer to pause briefly between words. It resets when the camera/session resets.

### 2. Temporal ASL rules remain explicit and testable

The existing common-sign fallback still uses completed temporal evidence for HELLO, NO, YES, PLEASE, SORRY, THANK YOU and I LOVE YOU. In particular, automatic YES requires a completed fist-nod trajectory and cannot be produced merely by forming or moving a fist. Synthetic regressions continue to cover common false-YES cases and SORRY/YES discrimination.

The new re-arm gate complements these rules; it does not replace the movement checks.

### 3. Automated labelled-video replay is now reproducible

The browser evaluator already replays local labelled clips through the normal camera-facing MediaPipe and recognition pipeline. It now also:

- hashes every source clip with SHA-256;
- rejects duplicate fixture IDs;
- rejects duplicate video bytes;
- records source provenance and declared evaluation split;
- fingerprints the complete selected fixture set in the Markdown report.

Raw participant video still stays local and is not committed by the evaluator.

### 4. Dataset splitting fails safer

The training manifest audit now rejects:

- duplicate sample IDs;
- duplicate video paths;
- missing required provenance/label/signer metadata;
- missing video files;
- unapproved licence identifiers;
- datasets with fewer than three signers when a three-way signer-independent split is requested.

The signer split always reserves at least one complete signer for train, validation and test. The generated CSV column order is deterministic, so its SHA-256 is meaningful across runs. The report includes sample counts, signer counts, class counts, class coverage gaps and any signer leakage per split.

Use `--require-class-coverage` when preparing a trainable benchmark to fail immediately if a class is missing from any split.

### 5. The trainer re-verifies its inputs

The GRU baseline no longer assumes that an upstream script was used correctly. Before training it checks:

- required feature-index fields;
- valid train/validation/test split names;
- no signer occurring in more than one split;
- every evaluated class occurring in every split;
- the explicit NO_SIGN class occurring in every split.

The feature-index SHA-256 and split sample/signer counts are written into model metrics.

Open-set confidence and margin thresholds are now calibrated by re-running validation inference on the **best checkpoint that will actually be evaluated/exported**, rather than on cached logits from the final epoch.

### 6. Landmark extraction handles broken media explicitly

The extraction stage now rejects unreadable videos and videos from which no sampled frames can be obtained. MediaPipe VIDEO timestamps are forced to remain strictly increasing even when a container reports repeated/non-monotonic millisecond timestamps.

## What did not change

The current Figma-derived UI, language selector, privacy copy, animations and visual assets were not modified by this hardening work.

The language adapter architecture is also unchanged. ASL, BSL, ISL, LSE and PSL continue to use their installed automatic research paths; languages without an installed shared model continue to use personal on-device calibration rather than silently borrowing another language's classifier.

## Validation commands

Run these before merging:

```bash
npm ci
npm run typecheck
npm test
npm run lint
npm run build:worker
node --check scripts/evaluate-video-regressions.mjs
python -m unittest training.test_pipeline
python -m py_compile training/pipeline.py training/extract_landmarks.py training/train_sequence.py
```

For a full static Firebase export:

```bash
npm run build:firebase
```

For a local labelled-video regression set:

```bash
npm run eval:video -- evaluation/video-manifest.local.jsonl --strict
```

## Remaining evidence gap

No amount of unit testing can establish real signer-independent live-camera accuracy. The remaining blocker is a frozen, consented, held-out video/live-camera set containing new signers plus explicit no-sign activity. Follow `evaluation/README.md` for the protocol.

Do not use the WLASL training/source performances themselves as evidence that the browser's MediaPipe adapter generalises to new live signers. Keep the current ASL automatic model labelled experimental until the live-domain benchmark exists.

The first practical benchmark should prioritise the seven explicit common-sign interactions and realistic no-sign motion. Once that gate is stable, expand the frozen evaluation vocabulary before making broader reliability claims.
