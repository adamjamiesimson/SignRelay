# SignBridge

SignBridge is a privacy-first research web application for continuous sign-language recognition. It observes ordered hand, face and upper-body landmarks, evaluates a language-specific temporal adapter, confirms only high-confidence sequences, and can read confirmed text aloud.

This repository is an engineering foundation, not a claim of full sign-language translation.

## What works now

- ASL, ISL and CSL have separate model adapter configurations.
- Camera permission is requested only after language selection.
- MediaPipe Gesture Recognizer, Face Landmarker and Pose Landmarker run in the browser on CPU.
- A Web Worker maintains an ordered 32-frame temporal buffer.
- The experimental ASL adapter includes four built-in signs and a 50-word personal vocabulary pack.
- Personal words are learned from one to three signer examples and matched on-device with dynamic time warping.
- Results are gated by confidence, temporal consensus and cooldown.
- Confirmed text can be edited, removed, saved locally, cleared and spoken.
- Auto speak, volume, rate and landmark overlay preferences are stored locally.
- Camera frames are not uploaded or stored.

## Honest model status

| Language | Status | Current vocabulary | Decoder |
| --- | --- | --- | --- |
| ASL | Experimental | 4 built-in signs + 50 personally calibrated words | Pretrained MediaPipe handshape classification, transparent temporal rules and on-device personal DTW templates |
| ISL | Model not installed | None | Separate inactive adapter |
| CSL | Model not installed | None | Separate inactive adapter |

The MediaPipe gesture submodel is genuinely pretrained and includes the `ILoveYou` canned class. The remaining starter ASL phrases use real landmark-sequence inference but rules are not dataset-trained. The 50-word pack activates word by word after a user records personal examples; it is not a population-trained classifier. There is no unrestricted ASL, ISL or CSL model in this repository.

## Architecture

```text
Camera
  → MediaPipe hand + face + pose inference
  → selected landmark compression
  → Web Worker rolling temporal buffer
  → language adapter + personal template matcher
  → confidence + temporal consensus
  → duplicate suppression
  → editable transcript
  → optional Web Speech API output
```

Important modules:

- `lib/vision-engine.ts`: model loading and per-frame holistic tracking
- `workers/recognition.worker.ts`: temporal buffer, segmentation and ASL starter inference
- `lib/model-adapters.ts`: independent language model registry
- `lib/decoder.ts`: confidence gating and duplicate suppression
- `components/translator-experience.tsx`: camera, transcript and speech experience
- `lib/browser-storage.ts`: device-local settings and transcript sessions
- `lib/calibration-storage.ts`: IndexedDB storage for normalized personal sign templates
- `lib/personalized-recognition.ts`: feature normalization and dynamic-time-warping comparison
- `training/`: reproducible dataset-to-browser model pipeline

## Local setup

Requirements: Node.js 22.13 or newer.

```bash
npm ci
npm run dev
```

The camera requires a secure origin in production. Localhost is treated as secure by modern browsers.

## Environment variables

No application secrets or paid API keys are required. Vision model assets are fetched from the official public MediaPipe model bucket and inference runs locally after loading.

## Training a larger model

Read [`training/README.md`](training/README.md), then use the provided pipeline entry point:

```bash
python training/pipeline.py --help
```

The pipeline is intentionally dataset-agnostic. A dataset adapter must provide source licence metadata, signer identity, gloss labels and video paths before preprocessing will proceed. This prevents silent dataset mixing and signer leakage.

Recommended stages:

1. Register a verified dataset and record its licence restrictions.
2. Extract hand, face and pose landmarks from every video.
3. Normalise by shoulder scale and body origin without mirroring labels.
4. Split by signer before augmentation.
5. Balance classes only in the training split.
6. Train a temporal model with an explicit blank/no-sign class.
7. Report top-k accuracy, precision, recall, F1 and confusion matrix.
8. For continuous data, report word error rate and boundary metrics.
9. Export to ONNX or TensorFlow.js and benchmark WebAssembly inference.
10. Add the checkpoint and vocabulary to one language adapter only.

Free GPU notebooks on Google Colab or Kaggle are appropriate for training; the deployed browser target remains CPU-compatible.

## Dataset research notes

- [WLASL](https://dxli94.github.io/WLASL/) contains more than 2,000 word-level ASL signs from over 100 signers. Its C-UDA terms restrict use to academic/computational purposes and disallow commercial use.
- [INCLUDE](https://dl.acm.org/doi/10.1145/3394171.3413528) reports 4,287 ISL videos across 263 signs. Re-check current access and redistribution terms before use.
- [CSL-Daily](https://ustc-slr.github.io/datasets/2021_csl_daily/) is a continuous CSL translation dataset with gloss and spoken-language annotations. Re-check access terms before training or redistribution.

Dataset names, vocabulary size and availability do not imply a licence suitable for deployment. The training pipeline requires a human-confirmed licence record.

## Testing

```bash
npm test
npm run lint
npm run test:rendered
```

The unit suite verifies low-confidence rejection, temporal consensus and duplicate suppression. The rendered test checks all public routes and production metadata.

## Deployment

The application targets the Vinext/Cloudflare-compatible Sites runtime. The production build emits the worker and static assets used by the hosted site.

## Privacy

- Camera video is processed locally by default.
- Raw video and biometric imagery are not uploaded or retained.
- Landmark sequences exist briefly in memory; normalized personal templates are stored only when the user deliberately records them.
- Transcript history and preferences are stored in local browser storage.
- The translator includes a one-click local-data clear action.
- There is no server-side training-data collection flow in this build.

## Known limitations

- Four ASL signs are built in; the 50 additional words require per-device personal calibration.
- Personal template matching is signer-specific and is not a substitute for a signer-independent ASL benchmark.
- Performance varies with viewpoint, signing speed, hand dominance, occlusion and lighting.
- Non-manual cues are represented in the feature structure but are not fully used by the starter decoder.
- No continuous unrestricted grammar decoder is installed.
- ISL and CSL are unavailable until independently trained checkpoints pass evaluation.
- The first model load requires internet access to download official MediaPipe assets.

## Roadmap

1. Create legally cleared, signer-independent ASL starter benchmarks.
2. Train and export a compact temporal sequence model with a blank class.
3. Add learned sign boundaries and continuous word error rate evaluation.
4. Co-design ISL and CSL adapters with native signers and language experts.
5. Add language-specific gloss-to-text decoding without hiding uncertainty.
