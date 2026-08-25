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
