# Slovo pretrained Russian Sign Language recognition

Authors: Alexander Kapitanov, Karina Kvanchiani, Alexander Nagaev and Elizaveta Petrova.

Source: https://github.com/ai-forever/slovo

Paper: Kapitanov et al., *Slovo: Russian Sign Language Dataset*, International Conference on Computer Vision Systems, 2023, pp. 63–73. https://arxiv.org/abs/2305.14527

Original pretrained model: MViTv2-small-32-2, 140,785,735 bytes. Exact source URL and SHA-256 are recorded in manifest.json. The ONNX weights are redistributed **unmodified**. labels.json is a format conversion of the official constants.py; class order and spelling are preserved. It contains 967 word/phrase classes, 33 fingerspelling letters, and one background output (not counted as a sign).

## Licence and changes

The source uses a **custom attribution/share-alike Public License**, based on but explicitly **not itself** Creative Commons BY-SA. Read [the complete supplied licence](LICENSE.pdf), also at https://github.com/ai-forever/slovo/blob/main/license/en_us.pdf. The model and adapted label map remain subject to those terms, separately from SignRelay application code. Attribution and the licence must accompany redistribution. No endorsement or affiliation is claimed.

The source materials are supplied AS IS, without warranties, including accuracy or fitness for a particular purpose, with the disclaimers and limitations in Section 5 of the supplied licence.

SignRelay adds browser-side letterboxing/normalisation, explicit 32-frame capture at approximately 15 fps, an idle-motion check, an 85% model-score gate and a 25-point competing-class margin. These gates are heuristics, not calibrated guarantees. The model output already contains probabilities. No second softmax is applied.

## Evaluation limits

The upstream README reports 64.09 for this model's benchmark metric. This is **not** SignRelay's camera accuracy. Native ONNX and single-thread WASM execution have been checked, including finite 1×1001 outputs. WASM inference took approximately 19 seconds on a synthetic clip in the development environment; other devices can be slower. These execution checks do not measure recognition quality. SignRelay has not completed independent live-camera or native-signer evaluation.

This model is isolated-sign classification, not sentence translation. Unknown signs and unrelated movement can still produce confident wrong results. Do not rely on it for medical, legal or emergency communication. Camera frames are processed locally, kept only in memory and discarded; no camera upload endpoint is used.
