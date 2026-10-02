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

Each sign clip should appear once per trial with its expected gloss. Add explicit no-sign/background clips too; do not loop or retry a clip until SignRelay produces the expected answer. Use stable pseudonymous `signer_id` values, mark genuinely held-out fixtures with `"split":"test"`, and record a short provenance label in `source`.

The evaluator computes a SHA-256 for every local clip, rejects duplicate fixture IDs and duplicate video bytes, and fingerprints the full fixture set in the generated report. This makes benchmark changes explicit instead of letting the same easy clip silently count more than once.

### Run it

```bash
npm run build:firebase
npm run eval:video -- evaluation/video-manifest.local.jsonl
```

By default the evaluator writes:

- `work/video-evaluation/results.jsonl` — one metadata row per fixture, including the source clip SHA-256, declared evaluation split, and provenance label;
- `work/video-evaluation/report.md` — fixture-set SHA-256 plus per-language accuracy, coverage, accepted precision, no-sign false-accept rate, tracking coverage, failures, and common confusions.

Useful options include `--language asl`, `--limit 20`, `--tail 5000`, and `--strict`. With `--strict`, a wrong sign, rejection, extra accepted word, or no-sign false accept produces a non-zero exit code, which makes the runner usable as a regression gate once a trusted fixture set exists.

The first trial after loading each language is labelled **cold**; later trials are **warm** so model-startup effects are visible rather than mixed together.

Automated replay is not a substitute for the signer-independent live-camera protocol above. A fixed clip set is excellent for detecting regressions, but it does not measure how well SignRelay generalises to new people, cameras, signing styles, backgrounds, or real interaction timing.

## Practical ASL release gate

Before describing the ASL browser recognizer as anything stronger than experimental, freeze a held-out evaluation set **before** tuning on its results. A practical first gate for the current prototype is:

1. Evaluate the seven explicit common-sign fallbacks (HELLO, NO, YES, PLEASE, SORRY, THANK YOU, I LOVE YOU) with at least four consenting held-out signers and multiple repetitions.
2. Add ordinary non-sign hand activity: resting, typing, pointing, adjusting clothing/hair, entering/leaving frame, and conversational gestures. Do not manufacture the no-sign class by chopping up sign clips.
3. Include at least two lighting/background conditions and more than one camera/device where possible.
4. Keep one frozen regression subset that is never used to tune thresholds or rules. New failure clips may be added to a separate development set, but the frozen set must stay unchanged so before/after results remain comparable.
5. Choose the pass/fail thresholds before the final run. For an assistive prototype, prioritize **accepted precision and no-sign false-accept rate** over forcing high coverage: a rejection is visible and recoverable, while a confident wrong word can silently alter meaning.
6. Report the exact number of signers, trials, covered glosses, device/condition breakdown, fixture-set hash, accepted precision, coverage, signed-trial accuracy, and no-sign false-accept rate. Do not extrapolate a small targeted benchmark into a claimed accuracy for all 2,000 ASL classes.

The 2,000-class WLASL-derived model and the seven rule-based fallbacks should be reported separately where possible. Passing the common-sign gate establishes reliability for those tested interactions only; it does not validate unrestricted ASL translation.


## Frozen external ASL cross-dataset benchmark

`evaluation/asllvd-v1.sources.jsonl` freezes a metadata-only set of 36 public ASLLVD citation-form clips by source URL, byte count and SHA-256. Thirty fixtures are deterministic exact-label overlaps with the installed 2,000-class ASL vocabulary; six additional fixtures stress the explicit HELLO and THANK YOU paths. Raw ASLLVD videos are never committed.

Prepare the local clips and manifest:

```bash
npm run eval:fetch-asllvd
```

Then, after the Firebase export exists:

```bash
npm run build:firebase
npm run eval:video -- evaluation/asllvd-v1.local.jsonl
```

This is an **external cross-dataset regression benchmark**, not a claim of unrestricted ASL accuracy. ASLLVD citation-form performances differ from the WLASL source domain and are intentionally useful for exposing domain-adapter failures. The public metadata does not give SignRelay a reliable signer identity for every numeric clip, so this set must not be described as a signer-independent accuracy estimate unless signer provenance is separately verified.

The benchmark currently contains sign-positive trials only. Realistic no-sign hand activity remains a separate release gate; do not manufacture that result by relabelling sign clips as negatives. Synthetic no-hand tests may be used as pipeline sanity checks but must be reported separately.
