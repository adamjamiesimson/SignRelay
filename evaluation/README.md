# Live-camera evaluation

This folder defines the signer-independent evaluation protocol for SignRelay. It exists to prevent live-camera quality from being inferred from training-set metrics, synthetic unit tests, or a single developer's webcam.

## Minimum protocol

For each automatic language model being evaluated:

1. Recruit multiple consenting signers who are not represented in the model training split when that identity information is available.
2. Use a fixed list of target signs plus explicit **no-sign** trials.
3. Record only the result metadata needed for evaluation. Do not commit raw participant video to this repository.
4. Test more than one device/camera condition and at least two lighting/background conditions.
5. Preserve rejected predictions as rejections. Do not silently retry until the expected answer appears.
6. Report signed-trial accuracy, accepted-sign coverage, precision when accepted, and no-sign false-accept rate separately.
7. Keep results language-specific. Do not turn one language's benchmark into a claim about another language.

## JSONL format

Store one JSON object per trial in a local file such as `evaluation/results/asl-2026-10.jsonl`:

```json
{"session_id":"S01","participant_id":"P01","language":"asl","trial_type":"sign","expected_gloss":"HELLO","predicted_gloss":"HELLO","accepted":true,"confidence":0.91,"device":"laptop-webcam","condition":"indoor-bright"}
{"session_id":"S01","participant_id":"P01","language":"asl","trial_type":"no_sign","expected_gloss":null,"predicted_gloss":null,"accepted":false,"confidence":0.12,"device":"laptop-webcam","condition":"indoor-bright"}
```

Use pseudonymous participant IDs. Do not put names, email addresses, biometric images, or raw videos in committed evaluation files.

## Summarise results

```bash
npm run eval:live -- evaluation/results/asl-2026-10.jsonl
```

The summariser reports, per language:

- signed-trial accuracy;
- coverage, meaning how often a sign was accepted rather than rejected;
- precision among accepted sign predictions;
- wrong accepted signs and common confusions;
- no-sign false-accept rate.

A model should not be promoted from experimental status on vocabulary size alone. Promotion requires a documented live-camera evaluation and explicit thresholds chosen before looking at the final results.

## Automated labelled-video regression

For repeatable development checks, SignRelay can replay labelled local video clips through the browser's real camera-facing pipeline. The evaluator replaces `getUserMedia()` with a local video-backed `MediaStream`, then lets the normal MediaPipe and recognition workers process those frames. This is useful for finding regressions, recurring sign confusions, rejections, false accepts, and tracking failures without manually signing every test case.

It currently covers the languages that share the standard translator camera/worker flow: **ASL, BSL, ISL, LSE, and PSL**. RSL and BdSL use separate recognizer flows and keep their specialised evaluation scripts/tests.

Raw clips stay local. The evaluator refuses HTTP(S) video URLs, stages each clip only under the ignored `out/__eval__/` directory while it runs, and writes metadata-only results. `evaluation/videos/` and the local manifest are gitignored.

### Set up a local fixture manifest

```bash
cp evaluation/video-manifest.example.jsonl evaluation/video-manifest.local.jsonl
# Put labelled clips under evaluation/videos/ and edit the manifest paths/glosses.
```

Each sign clip should appear once per trial with its expected gloss. Add explicit no-sign/background clips too; do not loop or retry a clip until SignRelay produces the expected answer.

### Run it

```bash
npm run build:firebase
npm run eval:video -- evaluation/video-manifest.local.jsonl
```

By default the evaluator writes:

- `work/video-evaluation/results.jsonl` — one metadata row per fixture;
- `work/video-evaluation/report.md` — per-language accuracy, coverage, accepted precision, no-sign false-accept rate, tracking coverage, failures, and common confusions.

Useful options include `--language asl`, `--limit 20`, `--tail 5000`, and `--strict`. With `--strict`, a wrong sign, rejection, or no-sign false accept produces a non-zero exit code, which makes the runner usable as a regression gate once a trusted fixture set exists.

The first trial after loading each language is labelled **cold**; later trials are **warm** so model-startup effects are visible rather than mixed together.

Automated replay is not a substitute for the signer-independent live-camera protocol above. A fixed clip set is excellent for detecting regressions, but it does not measure how well SignRelay generalises to new people, cameras, signing styles, backgrounds, or real interaction timing.
