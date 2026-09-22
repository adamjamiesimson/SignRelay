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

## Bangla VideoMAE research export (not installed)

The fetcher downloads the exact four model files and six publisher demo MP4s pinned in `training/export_bdsl401_onnx.py` into `work/bdsl401-research`. Downloads and the export both verify every hash before loading SafeTensors or decoding clips. Do not put those research assets in Git or `public/`.

```bash
python -m pip install torch==2.6.0 --index-url https://download.pytorch.org/whl/cpu
python -m pip install numpy==1.26.4 transformers==4.48.3 safetensors==0.5.3 onnx==1.17.0 onnxruntime==1.20.1 opencv-python-headless==4.11.0.86
python -m unittest discover -s training -p test_bdsl401.py
python training/fetch_bdsl401_research_assets.py
python training/export_bdsl401_onnx.py work/bdsl401-research/source work/bdsl401-research/clips
node scripts/verify-bdsl401-wasm.mjs
```

This uses the author's video-demo preprocessing, not the generic image processor's center crop. Exports preserve numeric class codes and now write English `labels.json` from the original dataset's word list. The 401 classes have 398 distinct English glosses; shared glosses do not merge trained classes. See `docs/pretrained-expansion-2026-09-16.md` for measured outcomes and remaining blockers.

Korean's separate `.github/workflows/ksl-research-check.yml` evaluates all 100 pinned publisher clips using the Tasks tracker and uploads only JSON reports. It has no deployment step. To fetch that complete set, run `python training/fetch_ksl_research_assets.py --clip-set test100`; evaluate it with `--tasks --manifest training/ksl_test100_manifest.json`. The default fetch remains the three-clip smoke set.

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

### Bangla size and runtime experiment

After the verified export above, compare dynamic quantization of constant-weight MatMul operations. The original float32 model is preserved. Signed int8 storage uses per-channel scales and reduced 7-bit weight range; convolutions and attention products remain float32. This follows the [ONNX Runtime quantization API](https://onnxruntime.ai/docs/performance/model-optimizations/quantization.html). Quantization is lossy: prediction and logit changes are reported explicitly, while cross-runtime equivalence is checked against each variant's own native outputs.

```bash
python training/quantize_bdsl401_onnx.py work/bdsl401-export work/bdsl401-research/clips
node scripts/benchmark-bdsl401-wasm.mjs float32 work/bdsl401-export/model.onnx
node scripts/benchmark-bdsl401-wasm.mjs int8 work/bdsl401-int8/model.int8.onnx
```

Run the two Node commands sequentially, each in a fresh process on the same host. Each uses one untimed warm-up and one timed inference per clip. Reports under `work/bdsl401-int8/` include hashes, all six predictions, timings and peak process RSS. RSS includes Node, model buffers, fixtures and WASM, so it is not a browser-memory estimate. Numerical differences are checked with the existing absolute/relative tolerance of 0.0002; the benchmark retains a complete JSON report and exits with failure if numerical parity or ordered top-five agreement fails. These six publisher-selected coded clips do not establish general accuracy. No script activates Bangla or installs weights into the app.

A separate weight-only experiment retains float32 activations and arithmetic, and inserts `DequantizeLinear` for the same 72 quantized MatMul weight tensors. The classifier Gemm and convolution remain float32. This checks whether stored-weight compression can avoid the dynamic activation quantization discrepancy observed between native and WASM. It does not promise faster inference.

```bash
python training/quantize_bdsl401_onnx.py work/bdsl401-export work/bdsl401-research/clips --weight-only
node scripts/benchmark-bdsl401-wasm.mjs int8 work/bdsl401-weight-only/model.int8.onnx work/bdsl401-weight-only
```

The default directories for dynamic and weight-only experiments are separate. Both retain class codes and attach the same verified-source English vocabulary. Runtime and real-browser validation remain required before app integration.

### Original Bangla vocabulary and 401-clip evaluation

`training/bdsl401_vocabulary.json` records all W001–W401 mappings, PDF page numbers, source attribution and four visually checked line-wrap repairs. The original PDF is in version 2 of the author's dataset. Download it with the URL in `extract_bdsl401_vocabulary.PDF_URL`; it is only 360,402 bytes and has a pinned SHA-256. Do not download the entire 52 GB video archive to obtain it.

```bash
python -m pip install pdfplumber==0.11.8
python training/extract_bdsl401_vocabulary.py work/research/bdsl-words-complete.pdf \
  --output work/research/reproduced-vocabulary.json
python -m unittest discover -s training -p 'test_bdsl401*.py'
python training/evaluate_bdsl401_publisher_set.py work/bdsl401-export
```

The extraction uses printed row codes instead of table borders: ordinary table extraction drops the first row on nine pages. English labels avoid the PDF's broken Bangla text encoding; no Bangla spelling corrections are guessed. The optional audit script detects the incomplete 392-entry community CSV and does not approve it for activation.

The 401-clip evaluator downloads the publisher's hash-pinned 167 MB archive, verifies its exact coverage (400 class codes, W109 twice, W111 absent), retains all predictions and errors, and records class-code accuracy separately from display glosses. It never relabels a duplicate clip to fill the gap. These are publisher-selected examples, not a representative held-out evaluation. `.github/workflows/bdsl401-research-check.yml` reproduces the original checkpoint export and this larger check with read-only repository permissions; it uploads reports only.
