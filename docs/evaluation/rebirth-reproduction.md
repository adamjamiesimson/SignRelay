# Reproducing the ASL development experiment

Use Node 22.13 or later and Python 3.12 with the [research dependencies](../../training/asl-rebirth-requirements.txt). Download dependencies and checksum-verified MediaPipe assets before processing videos. Run native extraction with outbound networking disabled. The pinned native package can attempt usage telemetry. Research assets remain under the ignored evaluation directory. [MediaPipe Tasks privacy notice](https://developers.google.com/edge/mediapipe/solutions/privacy)

```bash
npm ci
npm run install:vision-assets
python -m pip install -r training/asl-rebirth-requirements.txt
```

## Acquire and extract

The downloader reads HTTPS byte ranges from the official archives. It excludes reserved signers before requesting video bytes and freezes the manifest with recording SHA-256 hashes. The trainer checks signer aliases, identical recordings and source groups across splits. [PopSign v1.0 attribution and licence](https://signdata.cc.gatech.edu/view/datasets/popsign_v1_0/)

```bash
python training/import_popsign_development.py train --targets 16 --negatives 6 --takes-per-signer 2
python training/import_popsign_development.py val --targets 10 --negatives 4 --takes-per-signer 2
```

The extractor uses decoded presentation timestamps. It records per-trial errors for malformed video, nonmonotonic time and incomplete decode. Use `--resume` after a failed or interrupted extraction to retry failed and missing files. Successful traces are retained and the retry code is fingerprinted.

```bash
python training/extract_asl_development.py evaluation/derived/popsign-rebirth-v1/train.json evaluation/raw/rebirth-train20
python training/extract_asl_development.py evaluation/derived/popsign-rebirth-v1/val.json evaluation/raw/rebirth-val20
npx esbuild training/prepare-asl-features.ts --bundle --platform=node --format=esm --outfile=evaluation/derived/prepare-asl-features.mjs
node evaluation/derived/prepare-asl-features.mjs evaluation/derived/popsign-rebirth-v1/train.json evaluation/raw/rebirth-train20 evaluation/derived/popsign-rebirth-v1/train-features.json
node evaluation/derived/prepare-asl-features.mjs evaluation/derived/popsign-rebirth-v1/val.json evaluation/raw/rebirth-val20 evaluation/derived/popsign-rebirth-v1/val-features.json
```

## Fit and evaluate

Twelve time bins describe local hand shape and orientation, shoulder-relative wrist position, lip-relative fingertips and secondary-hand position. Four masks identify the available evidence. Empty bins carry zeros. The encoder declines clips with insufficient observed motion or continuity.

The trainer compares temporal centroids and class-balanced ridge regression with an explicit unsupported-sign class. Four grouped training folds determine cutoffs before scoring publisher validation for development. Model JSON carries the feature schema, data fingerprint, class vocabulary, standardization, weights and cutoffs. Scores are discriminant scores. Node replay checks parity with Python and compares two ways to spot a sign boundary. Source timings are measured from recording start.

```bash
python training/train_asl_temporal.py evaluation/derived/popsign-rebirth-v1/train-features.json evaluation/derived/popsign-rebirth-v1/val-features.json evaluation/derived/popsign-rebirth-v1/models
npx esbuild scripts/diagnostics/replay-asl-temporal.ts --bundle --platform=node --format=esm --outfile=evaluation/derived/replay-asl-temporal.mjs
node evaluation/derived/replay-asl-temporal.mjs evaluation/derived/popsign-rebirth-v1/val-features.json evaluation/raw/rebirth-val20 evaluation/derived/popsign-rebirth-v1/models/ridge.json evaluation/derived/popsign-rebirth-v1/models/ridge-trials.json evaluation/derived/popsign-rebirth-v1/ridge-replay.json
```

The optional RGB experiment uses the same samples and calibration folds with grayscale gradient descriptors from tracked hand crops and a fused representation.

```bash
python training/compare_asl_rgb.py evaluation/derived/popsign-rebirth-v1/train-features.json evaluation/derived/popsign-rebirth-v1/train.json evaluation/raw/rebirth-train20 evaluation/derived/popsign-rebirth-v1/val-features.json evaluation/derived/popsign-rebirth-v1/val.json evaluation/raw/rebirth-val20 evaluation/derived/popsign-rebirth-v1/rgb-comparison.json
```

## Browser validation

The runner accepts `--temporal-model=path/to/model.json` with a frozen development manifest and cohort lock. The diagnostic compares clip and spotted suggestions against current worker output, and fingerprints the weights.

```bash
npm run build:asl-demo
node scripts/prepare-recognition-lab.mjs
node scripts/run-recognition-video-evaluation.mjs /path/to/chrome docs/evaluation/popsign-development-2026-10-16.json evaluation/derived/rebirth-browser-pilot.jsonl --temporal-model=evaluation/derived/popsign-rebirth-v1/models/ridge.json
```

`training/make_asl_camera_fixture.py` and `scripts/diagnostics/camera-file-replay.mjs` feed a permitted clip through Chromium’s camera interface and the exported app. The protocol uses a prerecording with synthetic idle pre/post-roll. Speech instrumentation captures utterance requests. The tests exercise software paths and leave independent webcam and hardware checks pending.

Use the established [webcam protocol](webcam-validation-protocol-2026-11-16.md) and [reserved cohort lock](cohort-lock-2026-10-16.json) for the next release evaluation. Have fluent reviewers label sign identity, variants, start/end, technical failures and ordinary movement. Reserve the final set until an eligible candidate exists.
