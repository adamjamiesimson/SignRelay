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
- SignRelay's installed ASL model now uses the WLASL authors' official 1,000-class Pose-TGCN checkpoint and official OpenPose package under those same C-UDA terms. It provides 900 labels beyond the previous WLASL100 experiment. The published WLASL1000 Pose-TGCN benchmark is 34.86% top-1, 61.73% top-5 and 71.91% top-10. The browser export is per-output int8 with fused float16 batch normalisation; its live MediaPipe-to-OpenPose domain adapter remains experimental.
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

## Rebuild the installed WLASL1000 browser package

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
