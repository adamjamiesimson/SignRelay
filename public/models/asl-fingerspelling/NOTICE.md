# Independent FSboard sequence pilot v1

Original model architecture and training implementation: SignRelay fingerspelling sprint, 31 October 2026. No OpenFS code, weights, derived embeddings or weak labels were used.

Training data: FSboard version 13, Google / Deaf Professional Arts Network.
Source: https://www.kaggle.com/datasets/googleai/fsboard
Dataset licence: Creative Commons Attribution 4.0 International, https://creativecommons.org/licenses/by/4.0/
Modifications: filtered alphabetic sequences, uppercase text; independently extracted MediaPipe hand landmarks; independently trained GRU/CTC weights. Attribution and source identifiers are retained in docs/fingerspelling/evidence/fsboard-v13-provenance.json.

Model: fsboard-pilot-v1.onnx, 497759 bytes.
SHA-256: fbf35592acd849bf3b6b5621a23465ed134ffbc6ab049fbbf8db75916177c29a
Training source: 3c69ea0676e4e745ae575ddb4fce2a836933aa10.
Reproducible run: https://github.com/adamjamiesimson/SignRelay/actions/runs/41211037508
The dataset licence is the source-data attribution; no licence from an unrelated checkpoint is being claimed. This experimental model is not a validated A–Z product or a replacement for a sign-language interpreter.
