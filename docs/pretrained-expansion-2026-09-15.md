# Pretrained expansion — 15 September 2026

## Bangla: real checkpoint conversion verified

Converted [Shawon16's 401-class VideoMAE](https://huggingface.co/Shawon16/VideoMAE_BdSLW401_20_epochs_p5_SR_10/tree/f03fdadb20d1c59989ee7b2bfa95a07459b7fb56) from its pinned SafeTensors checkpoint to ONNX. All weights load without missing, unexpected or mismatched keys. Source files and six real clips are SHA-256 checked before export. No upstream Python code is executed.

The [author's demo](https://huggingface.co/spaces/Shawon16/BdSLW60/blob/50f72af4a9e00ca736d1b345f4d42a5e1740ca68/app.py) samples every tenth RGB frame, uniformly selects 16 observations, normalizes with ImageNet statistics, then resizes the full frame to 224×224. The export evaluation reproduces this with explicit bilinear antialiasing. The generic saved image processor would instead resize the short edge and center-crop: that is not the demo's input contract. Unit tests check full-frame edge preservation, RGB normalization, temporal truncation/repetition and numeric class order.

| Check | Observed result |
| --- | --- |
| Input / output | float32 `[1,16,3,224,224]` / `[1,401]` |
| Export size | 351,137,555 bytes |
| ONNX SHA-256 | `840f6862f3988616fda45ac06704ed4be1e0378e59460abd7b4ce18d3634ce73` |
| Native ONNX versus PyTorch | All six real clips passed; maximum absolute logit difference 0.0000334 |
| Numbered-class recognition | 4/6 top-1; 6/6 top-5 |
| Single-thread WASM in Node | Passed on W002S08F_03.mp4; max logit difference 0.00000778 |
| WASM timing on this host | 2,914 ms load; 13,798 ms inference |

All six standalone clips in the pinned author demo were included, including the two commented-out examples. These are publisher-selected examples, not a representative or independent accuracy benchmark. The [peer-reviewed paper](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0341909) reports a separate held-out test result; the model card's 99.2% validation result must not be presented as SignRelay accuracy. Full measured results are in `verification/bdsl401-verification.json` and `verification/bdsl401-wasm-verification.json`.

**Bangla is not installed.** The model's 401 outputs map to `W001`–`W401`. A verified mapping to readable Bangla words is still missing. The author demo and training notebook also use numbered labels. Runtime cost is too high to call this real-time, and actual browser/camera evaluation has not been performed. The model card declares CC-BY-NC-4.0; the original [BdSLW401 dataset](https://www.kaggle.com/datasets/hasanssl/bdslw401) separately declares CC-BY-NC-ND-4.0. Model weights, source videos and generated tensors are kept outside public assets and Git.

## Korean: reproducible tracker verification workflow

Added `fetch_ksl_research_assets.py` to fetch and hash-check the exact checkpoint, model modules, Tasks asset and three previously evaluated clips under Git-ignored `work/`. Added a feature-branch GitHub workflow with the system graphics libraries needed by MediaPipe 0.10.35. It exports the model, verifies PyTorch/ONNX equivalence and attempts the same three clips using the publisher's Tasks tracker.

The workflow has read-only repository permissions and uploads only JSON verification reports. It does not deploy, activate models, commit weights or change the hosting branch.

[Run 34934013369](https://github.com/adamjamiesimson/SignRelay/actions/runs/34934013369) completed successfully on commit `6b487ff9ef1f3e3ad91e3062302c785cfdaa7a98`. Dependency installation, all pinned downloads, native export parity and the Tasks tracker evaluation passed. On the same three clips, Tasks achieved 2/3 top-1 and 3/3 top-5, compared with legacy Holistic's 1/3 and 2/3. The 갈색 clip's left-hand coverage improved from 0% to 82%, and its expected word moved from rank 8 to rank 1. This resolves the missing-system-library blocker for the research test, while model reuse terms and broader signer/camera evaluation remain unresolved.

Measured per-clip JSON was mirrored from the completed job logs into `verification/ksl2946-tasks-clips.json`; the native export report is in `verification/ksl2946-ci-export.json`. The original two JSON files also remain in workflow artifact `10382362191` with seven-day retention. The CI export's binary hash differs from the earlier local export; each report records its own model hash and independently passing parity check. Do not substitute one export's hash for the other or infer equivalence solely from the checkpoint name.

## Coverage and release state

Three installed experimental languages currently meet the 400-class threshold: ASL, BSL and RSL. ISL remains at 263, Spanish's training path targets 300, and Korean/Bangla remain research candidates. The 15-language target remains incomplete. Work continues on `feature/pretrained-language-expansion`, where Vercel automatic deployment is disabled. Public feature-branch updates are authorized by the user's 14 September confirmation; deployment remains deferred.
