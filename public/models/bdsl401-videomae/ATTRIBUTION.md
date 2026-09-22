# Bangla isolated-sign research model

Model: **VideoMAE_BdSLW401_20_epochs_p5_SR_10** by Jubayer Ahmed Bhuiyan Shawon, Hasan Mahmud and Kamrul Hasan.

- [Original model and declared CC-BY-NC-4.0 terms](https://huggingface.co/Shawon16/VideoMAE_BdSLW401_20_epochs_p5_SR_10/tree/f03fdadb20d1c59989ee7b2bfa95a07459b7fb56).
- [CC-BY-NC-4.0 licence](https://creativecommons.org/licenses/by-nc/4.0/): attribution and non-commercial use requirements apply to these model weights, separately from the application code.
- [Authors' paper](https://arxiv.org/abs/2506.04367): *Fine-Tuning Video Transformers for Word-Level Bangla Sign Language: A Comparative Analysis for Classification Tasks*.
- [Pinned publisher demo](https://huggingface.co/spaces/Shawon16/BdSLW60/tree/50f72af4a9e00ca736d1b345f4d42a5e1740ca68) supplies the preprocessing reference and example clips.

Dataset and original English gloss mapping: **BdSLW401**, Husne Ara Rubaiyeat, Njayou Youssouf, Md Kamrul Hasan and Hasan Mahmud. [Dataset version 2](https://www.kaggle.com/datasets/hasanssl/bdslw401/versions/2) declares CC-BY-NC-ND-4.0; these terms are not replaced by the model licence. Source mapping: `bdsl words-complete.pdf`, SHA-256 `7996295dbdadbd0c4baa7e3c19e5c91c683a7e437467da6adf8bed1ba41099bd`. Raw source videos and the PDF are not included in the application. The original English glosses are reproduced in class order, without merging repeated glosses.

## Changes in SignRelay

Converted the pinned SafeTensors checkpoint to ONNX. Compressed constant matrix weights using per-channel signed int8 storage and explicit dequantization; activations and arithmetic remain float32. This is lossy weight compression, not dynamic activation quantization. Numerical execution was compared across native ONNX and single-thread WebAssembly using six pinned publisher clips. Browser RGB packing was separately compared with the author's PyTorch preprocessing.

All 401 source class IDs remain in order. They map to **398 distinct English glosses**: Wife, T-shirt and Scarf each name two different classes. English glosses are short dictionary labels, not a Bangla-language translation or independent linguistic review.

The camera captures approximately three full RGB frames per second, approximating the author's every-tenth-frame sampling for 30 fps video. It uniformly selects 16 frames with truncating indices, applies ImageNet normalization, and performs a full-frame bilinear antialiased resize. Capture timing on a live browser is an adaptation and requires further evaluation.

## Limits

This is an experimental isolated-sign model. It does not interpret continuous signing, grammar or sentences. A static-scene check is not a learned no-sign detector. Score and competing-class gates can still accept incorrect signs. Suggestions are not automatically spoken or added to a transcript.

Initial model transfer: 96,764,338 bytes. Single-thread WASM inference takes roughly 15 seconds on the development host; low-memory/mobile devices may be slower or unable to run the model. Camera frames stay in memory and are discarded. Publisher-selected example results do not establish independent signer or live-camera accuracy.

No endorsement by the model or dataset authors is implied. See the repository's dated verification reports for exact hashes, examples, outcomes and runtime conditions.
