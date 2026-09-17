# Pretrained expansion — 17 September 2026

This update supersedes the installation status in the 14–16 September research
notes. Work is on `feature/pretrained-language-expansion`. Firebase deployment
remains for the owner; no hosting branch or live site was updated.

## Installed coverage

| Language | Trained output classes | Coverage qualification |
| --- | ---: | --- |
| American (ASL) | 2,000 | Experimental WLASL isolated-sign model |
| British (BSL) | 1,064 | Experimental BSL-1K isolated-sign model |
| Russian (RSL) | 1,000 | 967 word/phrase classes and 33 letters; slow clip mode |
| Bangla | 401 | 398 distinct English glosses; slow clip mode |
| Spanish (LSE) | 300 | Health-domain signs, including label variants |
| Indian (ISL) | 263 | INCLUDE isolated-sign model |

Six languages have installed research models. Four have at least 400 classifier
outputs; only ASL, BSL and RSL currently have at least 400 word/phrase classes.
**The requested 15 languages with 400 words each are not complete.** The other
34 workspaces use personal teaching; Auslan is also marked in preparation.
No prompt list or personal recording is counted as pretrained coverage.
Independent live-camera and native-signer evaluation remain outstanding.

## Bangla integration

The verified 96,764,338-byte weight-only ONNX model is saved in the repository.
Its SHA-256 is `600c7a8064e5b41f24d145165990493c996ab7cf4b3a554aa7b354f18bad40a6`.
The UI loads it only after Start, captures one sign, runs it in a dedicated
worker and releases the camera and worker on cancellation, navigation or a
hidden tab. Suggestions are not automatically spoken or added to a transcript.

Production RGB preprocessing matches the publisher's PyTorch preprocessing on
six pinned clips, with maximum absolute input error below 0.000001. All six
native/WASM top-five rankings agree. The local single-thread WASM median was
14,990.5 ms; this does not establish mobile latency. Chrome camera capture,
model execution, cancellation, mobile layout and no-upload checks passed in
[run 35179535123](https://github.com/adamjamiesimson/SignRelay/actions/runs/35179535123)
and subsequent integration checks.

The original float32 publisher-clip result was 275/401 top-1 and 348/401 top-five.
That result must not be relabelled as a compact-model measurement. The compact
checkpoint has a separate evaluation workflow and report. The publisher archive
contains 401 clips covering 400 class codes: W109 twice, W111 absent. This is not
an independent benchmark. See the model's [attribution](../public/models/bdsl401-videomae/ATTRIBUTION.md)
for the distinct model and dataset terms.

## Spanish integration

[Training run 35179535121](https://github.com/adamjamiesimson/SignRelay/actions/runs/35179535121)
completed 24 epochs using the published, checksum-verified SWL-LSE landmark
release. Its best validation checkpoint was selected before the test evaluation.
Validation: 706/1,052 (67.11%). Test: 363/600 (60.50%).

The model passed PyTorch/ONNX conversion and WASM execution checks. The original
run's later build failed because it checked out before the Bangla weights were
saved. The Spanish artifact itself was recovered unchanged and hash-verified.

- Weights: 3,509,107 bytes; SHA-256 `58ce0f861f7e095054386435bf1a506b933a68883befee60a33c163a152d0ae3`.
- Original 300-class Spanish label ordering preserved.
- Full-clip resampling now matches training, including sequences longer than 64 frames.
- Missing landmark sentinels remain zero; inference tensors are disposed after every call.
- All six controlled preprocessing cases match the training reader within 0.00000024.
- The recognition worker routes Spanish separately and retains personal-template priority.

The split sizes were 6,348/1,052/600. The training script rejects duplicate and
cross-split sample files; signer independence has not been separately verified.
The training release uses legacy Holistic landmarks, while the camera uses
separate live trackers. Dataset accuracy is not live-camera accuracy.
[Dataset and model attribution](../public/models/lse300-swl/ATTRIBUTION.md).

Training now saves an atomic model/optimizer/RNG checkpoint after every epoch.
`--resume` checks the vocabulary and split signature before restoring it. A
controlled CPU interruption test produced exactly the same final model as an
uninterrupted run. A failed validation gate preserves progress and exports no
model. The training workflow is now manually triggered and preserves candidate
weights, progress reports and checkpoints for review.

## Remaining language work

Korean's 2,946-class research candidate still has `license: other` without a clear
reuse grant in its [publisher card](https://huggingface.co/Seoyoung07/korean-sign-word-classifier-mediapipe), checked again on 17 September. Its complete
tracker input also differs from the production tracker. The 100-clip research
result remains 57 top-1 / 71 top-five, not an installed-model claim.

Indian recognition remains at 263 classes. CISLR/iSign access conditions are not
bypassed, and no Hugging Face account or credentials are requested. Spanish's
300 classes and Bangla's 398 English glosses do not satisfy a 400-word goal.
Additional languages still require usable checkpoints, their own input adapters,
and measured recognition. SignCLIP remains a research candidate, not a shortcut
for claiming 15 verified language vocabularies.

## Integration verification

[Run 35201537540](https://github.com/adamjamiesimson/SignRelay/actions/runs/35201537540)
passed the static export, 201 application tests, TypeScript build, lint, both
Chrome flows, dependency/secret checks and two rendered-page checks. Spanish
completed three actual model inferences in a browser worker. The camera
checks use a fake camera and the model checks use controlled landmarks;
these are execution checks, not live sign-accuracy evidence.

The verified Spanish weights were committed as `f06e849949656bfe0f60bfa74fdadde373a3e7be`.
The extra permanent Spanish WASM asset test also passes locally.

## Owner's Firebase update

Use the feature branch, then run:

```bash
npm ci
npm run build:firebase
npm test
npm run lint
npm run audit:security
```

After reviewing the research limits, the owner can deploy the generated `out/`
with the existing Firebase configuration:

```bash
firebase deploy --only hosting --project signrelay-76f34
```

The build verifies the exact Bangla and Spanish assets and installs/verifies the
pinned Russian checkpoint. No account, API key or paid inference service is
needed by the app. Firebase deployment was not run during this work.
