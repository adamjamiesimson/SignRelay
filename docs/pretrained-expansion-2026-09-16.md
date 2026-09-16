# Four-language research update — 16 September 2026

## Bangla: original readable vocabulary recovered

Version 2 of the [author's BdSLW401 dataset](https://www.kaggle.com/datasets/hasanssl/bdslw401/versions/2) contains `bdsl words-complete.pdf`. The 360,402-byte PDF has SHA-256 `7996295dbdadbd0c4baa7e3c19e5c91c683a7e437467da6adf8bed1ba41099bd`. Its location was found in the archive's central directory; the [individual PDF download](https://www.kaggle.com/api/v1/datasets/download/hasanssl/bdslw401/bdsl%20words-complete.pdf?datasetVersionNumber=2) returned identical bytes.

All 401 codes now have source English glosses in `training/bdsl401_vocabulary.json`, with page references. There are **398 distinct English glosses**: Wife, T-shirt and Scarf each describe two separate trained sign classes. Do not claim 401 distinct English words. The source's Bangla text encoding is broken on extraction, so it is not used for display. Four line-wrap repairs were visually checked against the PDF. The nine previously missing rows were first rows on pages 3–11; each was visually checked.

The community CSV found at `sahebaakter/bdslw401-1st-processed` is incomplete: 392 entries, missing W070, W109, W146, W185, W224, W266, W308, W350 and W392. An identical CSV appears in `mdrabbi95/bdslw401-1-1st-checkpoint`. Both omit those page starts. Its audit is retained as a rejected candidate; the original PDF supersedes it.

The original and compressed export paths now write `labels.json` by class code, alongside `class-codes.json`. Unit tests reject missing, duplicate and untrusted-source vocabularies and verify that labels follow model output order. Existing six-clip measurements have a separately labelled readable-results report; those predictions were not rerun just to add words. The two existing mistakes become visible: Thread was predicted as Tube Light; Toothpaste as Alah or Mahavar.

A separate, read-only GitHub workflow exports the original checkpoint and evaluates all 401 clips in the publisher's example archive. Inspection found 400 represented class codes: W109 appears twice and W111 is missing. No clip is relabelled to fill that gap. The archive is pinned to the author Space revision and SHA-256. It preserves every prediction and decoding error. Results must be recorded after completion; creating the workflow is not evidence that recognition passed.

**Bangla remains inactive.** The readable English mapping gap is resolved, but the previously measured weight-only WASM median remains about 14.5 seconds, actual browser/camera testing remains incomplete, and a broad independent recognition evaluation is still needed. Original dataset terms remain CC-BY-NC-ND-4.0; the model card declares CC-BY-NC-4.0. A community mirror's different license does not replace source terms.

## Korean: all 100 publisher clips evaluated

[Run 34981403735](https://github.com/adamjamiesimson/SignRelay/actions/runs/34981403735), commit `a59ab475f86f5e7b31f7ed13d5030ceedd5e945f`, passed its execution and numerical conversion checks. The model recognized **57/100 first guesses** and **71/100 top-five guesses**. Maximum absolute PyTorch/ONNX logit difference was `0.000019073486328125`. Every expected clip was present and matched its SHA-256; the publisher-documented typo `꺠끗하다` maps explicitly to `깨끗하다`.

`verification/ksl-test100-tasks.json` preserves all per-clip results reconstructed from the successful job's JSON log records. These are publisher-selected clips, not signer-independent or live-camera validation. The 2,946-class model remains inactive: the publisher has not provided a clear reuse grant, and the application's compressed face landmarks do not match the model's full tracker requirements.

## Spanish and Indian: candidate limits verified

The actual [SignON Spanish PoseFormer checkpoint](https://huggingface.co/signon-project/slr-poseformer-lse/tree/9078e2ae57678c48d20e7e599a45657414bea22b) was inspected with `torch.load(weights_only=True)`. Its classifier weight is `[35,192]` and bias `[35]`: **35 classes**, not 192 or 400. The checkpoint hash and safe inspection method are retained in `verification/signon-lse-vocabulary-audit.json`; a reproducible audit script rejects it against the 400-class threshold. The existing SWL-LSE path has 300 classes. No qualifying Spanish checkpoint has been verified.

[CISLR](https://huggingface.co/datasets/Exploration-Lab/CISLR) describes a roughly 4,700-word Indian corpus and provides videos, annotations, prototypes and I3D features. The live page requires authentication and accepting its access conditions; the current browser session is logged out. The larger iSign dataset also requires authenticated access. A separate available pose-to-text T5 checkpoint does not establish a 400-word isolated-sign recognition vocabulary: language-model token counts must not be counted as recognized signs. The SignON model abbreviated ISL is Irish, not Indian. The currently installed Indian candidate remains at 263 classes.

## Delivery boundary

All work stays on `feature/pretrained-language-expansion`. No model was falsely marked active and no hosting branch was updated. Deployment remains deferred. The four candidates and overall 15-language goal are not complete.
