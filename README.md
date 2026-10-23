# SignRelay

SignRelay is a privacy-first research web application that recognises **isolated signs** from a live camera. It observes ordered hand, face and upper-body landmarks, evaluates a language-specific temporal adapter, confirms only high-confidence sequences, and can read confirmed words aloud. It does not translate continuous signing or full sentences.

This repository is an engineering foundation, not a claim of full sign-language translation.

## What works now

- Forty sign-language workspaces have separate identities; RSL and Bangla have separate pretrained clip-recognition modes.
- Camera permission is requested only after language selection.
- MediaPipe Gesture Recognizer, Face Landmarker and Pose Landmarker run in the browser on CPU.
- A Web Worker maintains an ordered temporal buffer for landmark recognition.
- ASL, BSL and ISL include separate experimental browser models with 2,000, 1,064 and 263 isolated-sign outputs respectively.
- RSL adds the official pretrained Slovo video model: 967 word/phrase classes plus 33 letters, with no personal teaching required. It is explicit single-sign capture, not real-time; 141 MB first load and approximately 19 seconds per inference in the development WASM test.
- Non-ASL/RSL/Bangla workspaces include 2,000+ searchable concept prompts plus unlimited custom words or short phrases; prompts activate only after the signer records examples in that language.
- Personal and user-defined words are learned from one to three signer examples and matched on-device with dynamic time warping.
- Results are gated by confidence, temporal consensus and cooldown.
- Confirmed text can be edited, removed, saved locally, cleared and spoken.
- Auto speak, volume, rate and landmark overlay preferences are stored locally.
- Camera frames are not uploaded or stored.

## GITEX YouthX demo (research prototype)

The October 2026 demo scope is six isolated ASL words: HELLO, THANK YOU, PLEASE, SORRY, YES and NO. When the recognizer is unsure it says so. The evidence is thin: on 11 previously seen development clips, 5 were correct, 0 wrong and 6 no-match; see [the dashboard](docs/evaluation/dashboard-2026-10-21.md). No new-signer, live-camera or false-positive measurement exists yet.

- Demo script, setup, fallbacks and go/no-go: [docs/gitex/demo-package-2026-10-21.md](docs/gitex/demo-package-2026-10-21.md)
- Operator kit for a real laptop, and the MAN-1/MAN-2, device and new-signer protocols: [docs/refinement/sprint-6/operator-kit.md](docs/refinement/sprint-6/operator-kit.md), [docs/refinement/sprint-6/field-test-protocols.md](docs/refinement/sprint-6/field-test-protocols.md)
- Machine-checkable acceptance criteria: [docs/gitex/demo-contract.json](docs/gitex/demo-contract.json)
- Integration report, current release status and the remaining manual checks: [docs/gitex/sprint-3/integration-report.md](docs/gitex/sprint-3/integration-report.md) and [docs/gitex/sprint-3/real-world-test-checklist.md](docs/gitex/sprint-3/real-world-test-checklist.md)

The offline demo, from a clean checkout (network needed once, for `npm ci` and the pinned vision models):

```bash
npm ci
npm run demo:prepare                 # ASL-only export, verified runtime
npm run demo:serve                   # loopback only; works with networking off
npm run demo:check -- /path/to/chrome   # strict check: no request may leave the machine
```

Add `?perf` to the URL for the device-test readout: tracking, round-trip and queue timings, forwarded and dropped frames, frames analysed per second, asset source, recognition state and recovery count, and the share of frames with a tracked hand. A warning appears if a full 5 s window stays below the 10 frames per second the demo needs. During live trials, record outcomes with `npm run eval:log` (see [Live-camera evaluation](#live-camera-evaluation)).

## Honest model status

The [17 September handoff](docs/pretrained-expansion-2026-09-17.md) records the current installation, evaluation limits and Firebase update steps.

| Language | Status | Current vocabulary | Decoder |
| --- | --- | --- | --- |
| ASL | Experimental | 2,000 built-in WLASL signs + user-defined personal words | Quantised official WLASL2000 Pose-TGCN, MediaPipe tracking and on-device personal DTW templates |
| BSL | Experimental | 1,064 automatic BSL-1K signs + unlimited signer-taught words | Official BSL-1K Pose2Sign model + personal DTW templates |
| ISL | Experimental | 263 automatic INCLUDE signs + unlimited signer-taught words | Official AI4Bharat INCLUDE transformer + personal DTW templates |
| RSL | Experimental, slow clip mode | 967 pretrained word/phrase classes + 33 fingerspelling letters | Official Slovo MViTv2-small-32-2 RGB ONNX; no personal recordings required |
| Bangla | Experimental, slow clip mode | 401 trained classes / 398 distinct English glosses | BdSLW401 VideoMAE with verified weight-only compression |
| LSE | Experimental | 300 trained health-domain sign classes | SignRelay-trained SWL-LSE temporal landmark model; 60.5% released test-split top-1, live accuracy unmeasured |
| PSL | Experimental | 775 official HFAD dictionary signs + unlimited signer-taught words | One-shot DTW match against a single official reference performance per sign; **not** a trained classifier, no accuracy evaluation exists |
| Auslan | Model preparing | 2,000+ teachable concepts + unlimited custom signs | Language-scoped personal DTW templates; no automatic output yet |
| 32 personal workspaces | Signer-taught | 2,000+ teachable concepts + unlimited custom signs | Language-scoped personal DTW templates |

### Spanish installation and use

The 3.5 MB Spanish model and 300 original labels are included and checksum-verified during the Firebase build. Choose Spanish Sign Language, start the camera, sign one word, then pause briefly. Personal examples retain priority. The model scored 706/1,052 on the released validation split and 363/600 on the released test split. These figures do not measure the live camera adapter. See [Spanish attribution and limitations](public/models/lse300-swl/ATTRIBUTION.md). The classes include health-domain sign variants and do not meet the 400-word target.

### Bangla installation and use

The compact model and its original class map are included in the feature branch; `build:firebase` verifies their checksums. Choose Bangla, start the camera, begin a capture, and choose **Finish sign** after one complete sign. Capture ends automatically after six seconds. The first model load is 97 MB; inference can take 15–60 seconds. Cancelling or leaving the tab discards frames and stops the camera and worker. Suggestions are not automatically spoken or inserted into a transcript.

See [Bangla model attribution](public/models/bdsl401-videomae/ATTRIBUTION.md) for model and dataset terms. This is an isolated-sign research preview, with unmeasured independent live-camera accuracy. The overall 15-language target is still incomplete.

### RSL installation and use

`npm run build:firebase` installs the official Slovo checkpoint automatically and verifies its pinned SHA-256 before exporting. `npm run install:rsl-model` installs it separately for development. The 141 MB binary is not committed to Git; builds fail if it cannot be fetched or verified. No paid service is used.

Choose **Russian Sign Language** (search for RSL), enter its workspace, start the camera, then choose **Recognize one sign**. After a 3-second countdown, sign for about 2 seconds. Inference runs in a separate worker; Stop/cancel, leaving the workspace or hiding the tab releases the camera and worker. Results are suggestions, not automatically spoken or added to a transcript. Frames stay only in device memory.

See [Slovo attribution and licence](public/models/rsl1000-slovo/ATTRIBUTION.md). The source uses a custom attribution/share-alike licence, not the application-code licence. Its benchmark results are not SignRelay live-camera accuracy. RSL has not received independent native-signer evaluation. This addition meets 400+ pretrained word/phrase classes for RSL; it does **not** establish 400+ pretrained signs for every workspace.

The 2,000-word ASL model is the official Pose-TGCN checkpoint genuinely trained on WLASL2000 OpenPose sequences. The checkpoint is quantised for browser inference and adapted from live MediaPipe points, so it remains an experimental test model rather than a claim of unrestricted translation. BSL and ISL likewise use their own official isolated-sign checkpoints. Typed custom words activate only after the signer records personal examples; they do not alter a shared model. The remaining languages never borrow, relabel or fabricate a checkpoint.

### PSL installation and use

The 775-sign HFAD dictionary bundle (`public/models/psl776-hfad/`) is checksum-verified during the Firebase build. Choose Pakistani Sign Language and sign naturally; recognition runs continuously like ASL/BSL/ISL/LSE, not as a slow single-capture mode. Unlike those four, PSL is **not a trained neural classifier** - each of the 775 signs has exactly one official reference performance from [HFAD, Lahore](https://github.com/sign-language-translator/sign-language-datasets) (CC BY 4.0), and recognition is one-shot dynamic-time-warping distance matching against that single reference, using the same matching code already used for a signer's own personal templates. No accuracy evaluation exists - not against held-out signers, not live-camera, not at all. See [PSL attribution and limitations](public/models/psl776-hfad/ATTRIBUTION.md).

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

No application secrets or paid API keys are required. The build copies the MediaPipe runtime from npm and installs size- and SHA-256-pinned vision models into `/vision/`, so the exported site serves its own tracking assets and inference runs locally.

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
npm run typecheck
npm test                 # unit, regression and synthetic recognition suites
npm run lint
npm run build:worker
npm run repo:guard       # asset size policy; no tracked live results or captures
npm run audit:secrets
npm run audit:deps       # production advisories fail; dev advisories need a dated review
npm audit --omit=dev
npm run build:firebase   # full multilingual export (downloads the RSL model once)
npm run audit:security   # strict release gate: npm audit, secret scan, rendered export
npm run build:asl-demo && npm run verify:runtime -- --out out --profile asl-demo
npm run demo:check -- /path/to/chrome
npm run readiness -- --label final --browser /path/to/chrome --build rehearsal,asl-demo
```

Browser smokes take a Chrome executable: `tests/workspace-browser-smoke.mjs`, `landmark-lifecycle-browser-smoke.mjs`, `rsl-`, `bdsl-` and `lse-browser-smoke.mjs` and `a11y-axe-smoke.mjs` need the full export; `offline-vision-smoke.mjs`, `offline-demo-strict-smoke.mjs`, `lifecycle-stress-smoke.mjs` and `fault-injection-smoke.mjs` need the ASL demo export; `gitex-rehearsal-smoke.mjs`, `transcript-a11y-smoke.mjs`, `user-feedback-fault-smoke.mjs` and `personal-vocabulary-scale-smoke.mjs` need `npm run build:rehearsal`. Do not run a build while a smoke is using `out/`.

Every pull request runs:

- **Core CI**: typecheck, tests, lint, workers, matching benchmarks, secret scan, dependency gate, asset policy;
- **Firebase Static Build Check**: the full export with all of its browser smokes, then the strict `audit:security` gate in its own job;
- **Offline ASL Demo and Rehearsal**: both demo profiles with the strict offline check (and its leak-detector self-test), rehearsal, transcript/accessibility, lifecycle-stress and fault-injection smokes;
- **ASL real-video pilot** when recognition code changes, and the private capture smoke when capture code changes.

The asset policy blocks new tracked files over 20 MiB; the two existing reviewed large ONNX files are explicit legacy exceptions and cannot grow without failing CI. Synthetic and headless results are regression records. They are not live-camera accuracy or real-device performance.

## Live-camera evaluation

Training metrics and synthetic tests are not treated as live-camera accuracy. SignRelay now has a language-specific, signer-independent evaluation protocol in [`evaluation/README.md`](evaluation/README.md), plus a JSONL summariser:

```bash
npm run eval:log                                        # operator log during a live session
npm run eval:live -- evaluation/results/<language>-<date>.jsonl
```

`evaluation/results/` is git-ignored and `repo:guard` fails if anything in it is tracked. Operator-log rows are unreviewed observations and are summarised separately from reviewed results.

The report separates signed-trial accuracy, accepted-sign coverage, precision among accepted predictions, common confusions and no-sign false-accept rate. Raw participant video and identifying participant data must not be committed to this repository. Experimental model status should only change after documented live-camera evaluation against thresholds chosen before the final results are inspected.

## Development workflow

`main` is the single authoritative, deployable branch. The older `feature/pretrained-language-expansion` and `claude/eager-fermi-mbevgh` names are historical compatibility refs only and should not be used for new work.

For future changes:

1. branch from the current `main`;
2. open a pull request back to `main`;
3. require **Core CI**, **Firebase Static Build Check** (including its strict dependency audit job) and **Offline ASL Demo and Rehearsal** to pass before merging;
4. deploy Firebase only from the merged `main` commit.

Before opening a pull request, run:

```bash
npm run typecheck
npm test
npm run lint
npm run build:worker
npm run repo:guard
```

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
- BSL and ISL use their own official isolated-sign checkpoints (1,064 and 263 labels respectively), still marked experimental because browser-side signer-independent evaluation has not yet been completed. Spanish adds a 300-class landmark model; Bangla and RSL use separate video models. The remaining workspaces are signer-specific until compatible, language-specific models are available and evaluated.
- A build needs internet access once, for `npm ci` and the pinned MediaPipe models; the exported site then serves its own tracking assets. The full build also downloads the 141 MB RSL model.
- With the hand kept in view, the motion segmenter does not split a sign's tail from the next movement, and a rule word can repeat from its own tail after a pause in view. An off-by-default guard is evaluated in [docs/gitex/sprint-3/tail-guard.md](docs/gitex/sprint-3/tail-guard.md); rest the hands between signs.

## Roadmap

1. Create legally cleared, signer-independent ASL starter benchmarks.
2. Train and export a compact temporal sequence model with a blank class.
3. Add learned sign boundaries and continuous word error rate evaluation.
4. Co-design shared adapters with native signers and language experts, prioritising the existing 40 language communities by data readiness and contributor interest.
5. Add language-specific gloss-to-text decoding without hiding uncertainty.
