# SignRelay

SignRelay is a privacy-first research web application for continuous sign-language recognition. It observes ordered hand, face and upper-body landmarks, evaluates a language-specific temporal adapter, confirms only high-confidence sequences, and can read confirmed text aloud.

This repository is an engineering foundation, not a claim of full sign-language translation.

## What works now

- Forty sign-language workspaces have separate identities, output locales and personal vocabularies.
- Camera permission is requested only after language selection.
- MediaPipe Gesture Recognizer, Face Landmarker and Pose Landmarker run in the browser on CPU.
- A Web Worker maintains an ordered 32-frame temporal buffer.
- ASL, BSL and ISL include separate experimental browser models with 2,000, 1,064 and 263 isolated-sign outputs respectively.
- Every non-ASL workspace includes 2,000+ searchable concept prompts plus unlimited custom words or short phrases; prompts activate only after the signer records examples in that language.
- Personal and user-defined words are learned from one to three signer examples and matched on-device with dynamic time warping.
- Results are gated by confidence, temporal consensus and cooldown.
- Confirmed text can be edited, removed, saved locally, cleared and spoken.
- Auto speak, volume, rate and landmark overlay preferences are stored locally.
- Camera frames are not uploaded or stored.

## Honest model status

| Language | Status | Current vocabulary | Decoder |
| --- | --- | --- | --- |
| ASL | Experimental | 2,000 built-in WLASL signs + user-defined personal words | Quantised official WLASL2000 Pose-TGCN, MediaPipe tracking and on-device personal DTW templates |
| BSL | Experimental | 1,064 automatic BSL-1K signs + unlimited signer-taught words | Official BSL-1K Pose2Sign model + personal DTW templates |
| ISL | Experimental | 263 automatic INCLUDE signs + unlimited signer-taught words | Official AI4Bharat INCLUDE transformer + personal DTW templates |
| LSE and Auslan | Model preparing | 2,000+ teachable concepts + unlimited custom signs | Language-scoped personal DTW templates; no automatic output yet |
| 35 personal workspaces | Signer-taught | 2,000+ teachable concepts + unlimited custom signs | Language-scoped personal DTW templates |

The 2,000-word ASL model is the official Pose-TGCN checkpoint genuinely trained on WLASL2000 OpenPose sequences. The checkpoint is quantised for browser inference and adapted from live MediaPipe points, so it remains an experimental test model rather than a claim of unrestricted translation. BSL and ISL likewise use their own official isolated-sign checkpoints. Typed custom words activate only after the signer records personal examples; they do not alter a shared model. The remaining languages never borrow, relabel or fabricate a checkpoint.

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
- `workers/recognition.worker.ts`: temporal buffer, segmentation, automatic model routing and personal inference
- `lib/model-adapters.ts`: 40-language registry and independent model contracts
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

The only supported public variable is `NEXT_PUBLIC_GA_MEASUREMENT_ID` (see `.env.example`). Leave it empty to disable analytics. To enable GA4, configure your own measurement ID, turn off Enhanced Measurement in the Google Analytics data stream (to avoid automatic collection of form, search and navigation data), choose the appropriate retention settings, and rebuild. Visitors must opt in before any analytics script loads. Never put a secret in a `NEXT_PUBLIC_` variable or in `public/`; both are delivered to browsers.

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
- [INCLUDE](https://huggingface.co/datasets/ai4bharat/INCLUDE) publishes CC-BY-4.0 metadata for 4,292 ISL videos across 263 signs. The repository contains an audited, **not-trained** 100-label candidate vocabulary in training/manifests/isl100-include-vocabulary.json; public metadata does not identify signers, so it is not yet suitable for SignRelay's signer-aware benchmark.
- [SLR500](https://ustc-slr.github.io/datasets/2015_csl/) offers 500 isolated CSL signs, but its official research agreement must be signed by a full-time staff member. No CSL vocabulary or model is bundled until that permission or an appropriate open alternative is available.

Dataset names, vocabulary size and availability do not imply a licence suitable for deployment. The training pipeline requires a human-confirmed licence record.

## Testing

```bash
npm test
npm run lint
npm run build:firebase
npm run audit:security
```

The unit suite verifies low-confidence rejection, temporal consensus and duplicate suppression. The rendered test checks all public routes and production metadata.

## Deployment

The application is a Next.js static export hosted on Firebase. There are no deployed server API routes, admin pages, user accounts or cloud database. Run `npm ci`, then `npm run build:firebase`, then `firebase deploy --only hosting --project signrelay-76f34`. Deploy only `out/`, as configured in `firebase.json`. Build-generated HTML policies and Firebase response headers work together; do not skip the secure-export build step. `npm start` serves the export locally for verification.

See [the security audit](docs/SECURITY-AUDIT-2026-09-11.md) for checked controls, limitations and Firebase account settings that need owner verification. The Privacy Policy and Terms pages describe this research build; review them against your actual operator details and applicable requirements before public launch.

## Privacy

- Camera video is processed locally by default.
- Raw video and biometric imagery are not uploaded or retained.
- Landmark sequences exist briefly in memory; normalized personal templates are stored only when the user deliberately records them.
- Transcript history and preferences are stored in local browser storage.
- The translator includes a one-click local-data clear action.
- There is no server-side training-data collection flow in this build.

## Known limitations

- The installed ASL checkpoint is the official experimental 2,000-sign WLASL Pose-TGCN model. Its live MediaPipe input adapter and closed-set rejection gate must still be evaluated separately.
- Personal template matching is signer-specific and is not a substitute for a signer-independent ASL benchmark.
- Performance varies with viewpoint, signing speed, hand dominance, occlusion and lighting.
- Non-manual cues are represented in the feature structure but are not fully used by the starter decoder.
- No continuous unrestricted grammar decoder is installed.
- BSL and ISL use their own official isolated-sign checkpoints (1,064 and 263 labels respectively), still marked experimental because browser-side signer-independent evaluation has not yet been completed. The other workspaces are signer-specific until compatible, language-specific models are legally available and evaluated.
- The first model load requires internet access to download official MediaPipe assets.

## Roadmap

1. Create legally cleared, signer-independent ASL starter benchmarks.
2. Train and export a compact temporal sequence model with a blank class.
3. Add learned sign boundaries and continuous word error rate evaluation.
4. Co-design shared adapters with native signers and language experts, prioritising the existing 40 language communities by data readiness and contributor interest.
5. Add language-specific gloss-to-text decoding without hiding uncertainty.
