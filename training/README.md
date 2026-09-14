# SignRelay training pipeline

The training path is designed for repeatability and licence traceability. It does not download or relabel a dataset automatically.

## Dataset manifest

Prepare a CSV with these columns:

```text
sample_id,video_path,gloss,signer_id,language,source,license_id,split
```

`signer_id`, `source` and `license_id` are required. `split` may be blank before the signer-independent split step.

## Registered research sources

- **manifests/isl100-include-vocabulary.json** is a **curated, not-trained** 100-label ISL candidate vocabulary from the public [INCLUDE](https://huggingface.co/datasets/ai4bharat/INCLUDE) metadata. It is CC-BY-4.0 and every selected label appears in each published metadata split. Run **python training/fetch_include_isl100_metadata.py** to re-audit the paths and licence before work begins.
- INCLUDE's public metadata does not provide signer IDs. The audit therefore marks it **not train-ready**: do not put its provisional CSV through pipeline.py or report signer-independent accuracy until a signer-aware evaluation plan is available.
- WLASL500 needs a recorded acceptance of WLASL's C-UDA terms plus lawful access to the original video/keypoint data. The existing WLASL100 experiment must not be mechanically expanded and relabelled as WLASL500.
- SignRelay's current installed ASL model uses the WLASL authors' official 2,000-class Pose-TGCN checkpoint under those same C-UDA terms (`public/models/asl2000-tgcn`). The WLASL1000 rebuild instructions below describe the earlier package. Its published benchmark does not establish accuracy for the current browser model. The quantized browser model's live MediaPipe-to-OpenPose domain adapter remains experimental.
- If the data user has accepted the C-UDA but the preprocessed package has not arrived, `download_wlasl500.py` can make a slow, resumable, rate-limited attempt to retrieve the publisher-listed raw source clips. To preserve the existing WLASL100 model and add 500 new labels, run `PYTHONPATH=/tmp/signrelay-ytdlp python training/download_wlasl500.py WLASL_v0.3.json --classes 500 --skip-first 100 --confirm-cuda --direct-only --require-direct-splits --max-downloads 500 --workers 3`. The selector skips the existing 100, requires official train/validation/test source coverage for every chosen extension label, and balances early attempts across all 500 labels. It records every source URL and failure, rejects HTML/error pages disguised as media, keeps raw data outside the app, and must never be used to claim a model is trained before the whole pipeline has passed. Keep concurrency modest so publisher sites are not overloaded.
- Once the approved WLASL clips arrive, run `python training/prepare_wlasl500.py WLASL_v0.3.json videos --output artifacts/wlasl500/manifest.csv`. It selects the official top-500 glosses, preserves the publisher's split, refuses missing clips, and writes a signer-overlap report. It does **not** create a trained model by itself.
- A deployable ASL500 model also needs a separate `NO_SIGN` class made from explicitly consented non-sign videos. Do not call arbitrary footage, chopped sign clips, or tracker failures `NO_SIGN`. The trainer refuses to run without real `NO_SIGN` examples in train, validation, and test, and calibrates its rejection thresholds only on validation data.
- The official CSL/SLR500 and CSL-Daily releases require a research agreement signed by a full-time staff member. They are not cleared for this student project yet, so no CSL vocabulary or checkpoint is bundled.

## Stages

1. `audit`: validate files, labels, signer IDs and an approved licence record.
2. `extract`: run MediaPipe hand, face and pose landmark extraction.
3. `normalise`: translate to a body-centred origin, scale by shoulder distance and pad/mask missing landmarks.
4. `split`: assign complete signer groups to train, validation or test.
5. `train`: fit a GRU, temporal convolution or compact Transformer with a blank/no-sign class.
6. `evaluate`: produce per-class precision, recall, F1, top-k accuracy and a confusion matrix. Continuous models also produce word error rate.
7. `export`: export ONNX with dynamic batch size and a fixed sequence/feature contract.
8. `benchmark`: measure WebAssembly latency, memory and frames per second on CPU.

## Rebuild the historical WLASL1000 browser package

After accepting WLASL's C-UDA, download the official Pose-TGCN `archived.zip`, `splits.zip` and `pose_per_individual_videos.zip` files linked by the WLASL authors. Keep the raw keypoints and checkpoint outside the public application directory. Export with:

```bash
python training/export_wlasl1000_tgcn.py \
  /private/wlasl/archived/asl1000/ckpt.pth \
  /private/wlasl/splits/asl1000.json \
  --output public/models/asl1000-tgcn \
  --spotcheck-report artifacts/wlasl1000-evaluation.json
```

Evaluate the original and quantised checkpoint on held-out official pose sequences with:

```bash
python training/evaluate_wlasl1000_tgcn.py \
  /private/wlasl/archived/asl1000/ckpt.pth \
  /private/wlasl/splits/asl1000.json \
  /private/wlasl/pose_per_individual_videos.zip \
  --samples 100 --output artifacts/wlasl1000-evaluation.json
```

## Korean research export (not installed)

`export_ksl_onnx.py` converts the pinned Seoyoung07 2,946-class checkpoint, including raw-landmark preprocessing. Download the files listed in `SOURCE_HASHES` from the script's exact `SOURCE_REVISION` into a private directory. The script checks every hash and label ID before export. Keep the source and weights out of Git and app assets: the publisher's `other` license entry does not specify redistribution terms.

```bash
python -m pip install torch==2.6.0 --index-url https://download.pytorch.org/whl/cpu
python -m pip install onnx==1.17.0 onnxruntime==1.20.1
python training/export_ksl_onnx.py /private/ksl-source --output work/ksl2946
node scripts/verify-ksl-wasm.mjs work/ksl2946
```

Input is `[1,64,115,4]` float32 plus `[1]` int64 lengths, already sampled at 15 fps. `lib/ksl-input.ts` packs synchronized Holistic observations; the existing compressed `VisionFrame` is incompatible. Verification fixtures are synthetic and establish numerical equivalence, not recognition accuracy. WASM verification uses Node, not a browser. See `docs/pretrained-expansion-2026-09-14.md` for remaining release gates.

### Labelled Korean clip smoke test

`evaluate_ksl_clips.py` checks the same pinned checkpoint against native ONNX on local MP4s named with exact class labels. Also fetch `model/keypoint_extractor.py` from the pinned source revision. Use a separate environment with NumPy 1.26.4, MediaPipe 0.10.21 and OpenCV headless 4.11.0.86 for the legacy Holistic result recorded here; the exporter dependencies are also required. Video hashes, tracker coverage and all top-five predictions are saved, including failures.

```bash
python training/evaluate_ksl_clips.py /private/ksl-source work/ksl2946 /private/labelled-clips \
  --output work/ksl2946/real-clips.json \
  --dataset-source https://huggingface.co/datasets/Seoyoung07/korean-sign-word-classifier-mediapipe-test-100/tree/5dc76d221db9b74cc719cbbfb7528c7b5ec6a56d
```

The optional `--tasks` flag selects the publisher's pinned `model/assets/holistic_landmarker.task`. MediaPipe 0.10.21 Tasks aborted with an empty-packet error in this environment; do not present that run as a passed test. See the dated verification note for subsequent runtime results. Raw clips and models must remain outside the public app and Git.

## Leakage controls

- Never split individual clips before grouping by signer.
- Fit normalisation statistics only on the training split.
- Apply augmentation only to training samples.
- Keep near-duplicate source videos in the same split.
- Report signer count and class distribution for every split.

## Version bundle

Every browser model directory should contain:

```text
model.onnx
vocabulary.json
adapter.json
metrics.json
dataset-card.md
sha256.txt
```

`adapter.json` must declare language, input landmark order, sequence length, confidence threshold, decoder version and model version.
