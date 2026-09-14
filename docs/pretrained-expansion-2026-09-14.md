# Pretrained expansion checkpoint — 14 September 2026

The target remains at least 15 sign languages with 400 recognizable words each, using genuine pretrained models rather than personal recordings. It is not complete. ASL, BSL and RSL currently meet the installed class-count threshold; their live recognition remains experimental. ISL has 263 classes. LSE is preparing a 300-class model and would still be below the requested threshold. Language selectors are not installed recognition models.

## Korean research conversion

- Source: [Seoyoung07 Korean classifier, pinned revision](https://huggingface.co/Seoyoung07/korean-sign-word-classifier-mediapipe/tree/214c0d87294695f4c79086440404bfb72fa7c5bc). Genuine epoch-41 weights, 2,946 classifier outputs. Some labels are spelling variants; distinct word coverage has not been audited.
- The exporter verifies the source and checkpoint hashes, loads weights with `weights_only=True`, checks every class ID against the checkpoint, exports raw-input preprocessing and compares all output logits with PyTorch for three sequence lengths.
- Reproduced ONNX file: 22,623,947 bytes; SHA-256 `4e3640d66b1630292dcc96b0ad6150e454e1a3947055409cc99444458f1d40df`. Native and single-thread ONNX Runtime Web WASM parity passed. See `verification/ksl2946-*.json` for actual measurements. The WASM test ran in Node; it is not a browser/camera test or a sign-accuracy benchmark.
- Added a TypeScript input adapter for the exact 115-point Holistic layout: 13 pose points, 21 points per anatomical hand, and 60 selected face points. It requires synchronized, full indexed observations, rejects partial/malformed inputs and preserves zero padding and confidence. The app's compressed face cues and cached pose cannot be substituted for this contract.
- The source model card lists its license as `other` without explicit reuse/redistribution terms. Keep upstream source, checkpoint and generated weights outside public app folders and out of Git. Korean remains inactive pending clarified terms, realistic evaluation and a compatible live extractor. The app remains free and noncommercial; that alone does not resolve missing model terms.

### Real Korean clips

The first three alphabetically sorted filenames in the [publisher's Test-100 dataset](https://huggingface.co/datasets/Seoyoung07/korean-sign-word-classifier-mediapipe-test-100/tree/5dc76d221db9b74cc719cbbfb7528c7b5ec6a56d) were selected before inspecting predictions. Each local video was checked against that pinned dataset revision. With MediaPipe 0.10.21 legacy Holistic, one of three was correct at top-1 and two of three at top-5. Native ONNX and PyTorch matched on all three, with maximum logit difference below 0.000014. The brown-color clip had no detected left hand and only 60% right-hand coverage; tracking quality is a concrete evaluation concern. These are three isolated clips, not a general accuracy estimate or proof of signer independence. Full per-clip results and hashes are in `verification/ksl2946-real-clips.json`.

The publisher's pinned Tasks asset was also downloaded and hash-checked. MediaPipe 0.10.21 Tasks aborted with `holder_ != nullptr: The packet is empty` on the first clip. MediaPipe 0.10.35 instead failed loading its native library because `libGLESv2.so.2` was unavailable; installation of that system dependency was blocked by this runtime's package-manager permissions. No Tasks predictions or accuracy are claimed. Re-run `evaluate_ksl_clips.py --tasks` in an environment with the required system libraries before judging the publisher's Tasks pipeline.

## Spanish download repair

The [latest examined training run](https://github.com/adamjamiesimson/SignRelay/actions/runs/34752506875) failed on repeated HTTP 504 responses while downloading the 3.5 GB landmark archive, before training began. The workflow now calls `training/download_swl_lse.py`: bounded 32 MiB ranges, validation of response ranges and sizes, retry/backoff, partial-file resumption, and published MD5 verification before atomic installation. Unit tests exercise resume, invalid server responses, cache reuse and checksum failures. Official endpoints were checked with real HTTP 206 responses and the two small files were downloaded and verified. The full archive was not completed and no trained LSE model is claimed.

## Bangla candidate

[Shawon16's BdSLW401 checkpoint](https://huggingface.co/Shawon16/VideoMAE_BdSLW401_20_epochs_p5_SR_10/tree/f03fdadb20d1c59989ee7b2bfa95a07459b7fb56) declares CC-BY-NC-4.0 and 401 output IDs. It is an RGB VideoMAE model, not a landmark classifier. The published config maps classes to `W001`–`W401`; a verified map to readable Bangla words has not been found in the model or [author's code](https://github.com/JubayerAhmedShawon/Word_Level_SLR_Codes). Do not fabricate labels or count it as installed.

## Additional source checks

[SLRZoo's download script](https://github.com/iliasprc/slrzoo/blob/main/download.sh) downloads PHOENIX data but ends with an unfinished `gdown` placeholder for pretrained embeddings. Its README alone does not establish an accessible trained German recognizer. [SignCLIP's authors](https://github.com/J22Melody/fairseq/tree/main/examples/MMPT#demo-and-model-weights) publish multilingual and specialized weights. However, their [paper](https://aclanthology.org/2024.emnlp-main.518/) distinguishes strong dictionary-domain retrieval from weaker immediate recognition on new datasets. It remains an expansion research candidate requiring per-language vocabulary, license and evaluation work; its multilingual training count is not SignRelay's installed language count.

## Release state

The local feature branch is `feature/pretrained-language-expansion`. Its Vercel configuration disables automatic deployments for that branch, following the instruction to avoid deployment until the project is complete. No deployment or successful push was performed. Automatic approval review rejected pushing this work to the public repository without explicit user permission; ownership was checked but did not clear that restriction. A standalone source patch preserves the reviewable changes.

Validation: all 190 app tests, three Python downloader/label-contract tests, ESLint and TypeScript checks passed. Numerical native/WASM conversion checks and the three legacy Holistic clip comparisons passed; recognition outcomes and Tasks runtime failures are described separately above.

Next work: realistic Korean clip checks, readable Bangla vocabulary provenance, and additional licensed checkpoints with at least 400 classes. None of these candidates changes the current count of three installed languages above the class threshold.
