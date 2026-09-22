# Pretrained expansion audit — 12 September 2026

The target is at least 400 trained word/sign classes per additional language, without requiring a user to teach the recognizer. A language selector, translated label or list of prompts does not satisfy this target.

## Delivered in this change

Russian Sign Language: official Slovo MViTv2-small-32-2 ONNX checkpoint, **967 distinct word/phrase labels and 33 fingerspelling letters**, plus a background output excluded from the count. The original weights and label order are preserved. See `public/models/rsl1000-slovo/manifest.json` for the pinned download, byte count and SHA-256, and its `ATTRIBUTION.md`/`LICENSE.pdf` for terms.

The application offers explicit camera-clip recognition with a countdown, local RGB preprocessing, worker inference and cancellation. This is a slow experimental mode, not real-time signing or sentence translation. No signer training is needed. No video is uploaded or written to storage.

Checks completed:

- Native ONNX and single-thread WASM execute the exact checkpoint and produce finite 1×1001 probabilities. Synthetic-input WASM inference took approximately 19 seconds here.
- 173 unit tests passed, including the vocabulary count, RGB channel/time ordering, normalization, idle rejection and background/ambiguous output rejection.
- Chrome smoke test with the upstream public example video as a fake camera: language search, keyboard focusability, mobile overflow, deferred model loading, real ONNX loading, clip capture, inference completion, cancellation, camera release and back navigation passed. No POST requests and no uncaught page errors were observed. The example capture produced no confident match; this is execution verification, not a recognition-accuracy result.
- Lint, TypeScript/static build and exported-page/security checks passed during integration.

Live-camera accuracy, native-signer validation, confidence calibration and Intel-iGPU performance have **not** been established. The app uses single-thread CPU WASM for portability; no GPU acceleration claim is made.

## Other sources investigated

| Source | Language / published classes | Finding / concrete next requirement |
| --- | --- | --- |
| [INCLUDE](https://huggingface.co/datasets/ai4bharat/INCLUDE) | ISL, 263 | Existing checkpoint is below 400. A larger training corpus or checkpoint is required. |
| [SWL-LSE](https://zenodo.org/records/13691887) | LSE, 300 | Dataset is below 400; expanding the label list cannot expand recognition. |
| [SLR500](https://ustc-slr.github.io/datasets/2015_csl/) | CSL, 500 | Official access requires a university/research-institute agreement signed by full-time staff; student signatures are not accepted. No agreement submitted. |
| [MM-WLAuslan](https://uq-cvlab.github.io/MM-WLAuslan-Dataset/docs/en/dataset-download) | Auslan, 3,215 | Dataset publishes CC BY-NC-SA 4.0 terms. Public download includes poses, labels and splits. One training/validation camera pose file alone is 5,909,029,404 bytes. No finished recognition checkpoint was found in the official release reviewed. Need data acquisition, a trained temporal model, held-out evaluation and browser export. |
| [BosphorusSign22k](https://ogulcanozdemir.github.io/bosphorussign22k/) | Turkish, 744 | Authors require an EULA submission for research access. No agreement submitted and no outreach sent. AUTSL's 226-class checkpoint cannot meet this target. |
| [KArSL](https://hamzah-luqman.github.io/KArSL/) | Arabic dictionary resources, 502 | Public data and author training code exist. The reviewed [SLR_AMN](https://github.com/Hamzah-Luqman/SLR_AMN) and [SignVLM](https://github.com/Hamzah-Luqman/signVLM) repositories did not provide a downloadable trained 502-class release. Must resolve model/data reuse terms and obtain/train weights. Do not equate these resources with validated Emirati or all Arabic regional sign languages. |
| [OpenHands](https://github.com/AI4Bharat/OpenHands) | Several languages | Released AUTSL, GSL and LSA64 checkpoints have 226, 310 and 64 classes respectively. CSL/DEVISIGN checkpoint provenance involves proprietary source datasets; the code licence alone is not recorded as permission to redistribute all underlying materials. |
| [SignCLIP](https://github.com/J22Melody/fairseq/tree/main/examples/MMPT) | Multilingual pretrained pose/text encoder | Real weights exist, but this is a retrieval encoder rather than 400 verified recognition labels for each language. Needs confirmed model redistribution terms, the exact pose preprocessing (more face landmarks than SignRelay currently retains), language-conditioned vocabulary and independent recognition evaluation. No external demo API is used. |

No model, training dataset, benchmark accuracy or permission was fabricated to fill the remaining language slots. The wider 15-language/400-class ambition remains incomplete.
