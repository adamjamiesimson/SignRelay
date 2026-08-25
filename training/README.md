# SignRelay training pipeline

The training path is designed for repeatability and licence traceability. It does not download or relabel a dataset automatically.

## Dataset manifest

Prepare a CSV with these columns:

```text
sample_id,video_path,gloss,signer_id,language,source,license_id,split
```

`signer_id`, `source` and `license_id` are required. `split` may be blank before the signer-independent split step.

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
