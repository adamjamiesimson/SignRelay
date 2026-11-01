# Independently trained FSboard research model

`fsboard-accuracy-v2.onnx` was independently trained by this SignRelay sprint, using original code in `training/fingerspelling/accuracy`. No OpenFS implementation or checkpoint was incorporated. Dataset: Google / Deaf Professional Arts Network, [FSboard version 13](https://www.kaggle.com/datasets/googleai/fsboard/versions/13), CC BY 4.0. Attribution and source byte hashes are preserved in `docs/fingerspelling/evidence/accuracy-v2-provenance.json.gz`. The model weights are made available under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

Model SHA-256: `26e640751c91f3cfba5aa7e3af43abb1e322c58f7a0c9fc7ae04fefe9ad74c41`; 523,322 bytes; 130,108 parameters. Selected motion-aware BiGRU with visual CTC beam 8, no dictionary or language model. See the engineering report for frozen split, preprocessing and evaluation contracts.

Research-only. Exact text was correct on 118/384 fresh final clips; CER 12.40%. No calibrated acceptance threshold qualified. Every displayed candidate is uncertain and requires explicit review and confirmation. Non-fingerspelling actions can produce text. Physical webcam and independent Deaf-user validation are outstanding.

The original `fsboard-pilot-v1.onnx` remains unchanged for research rollback. Licensed action-negative videos were used only for evaluation, never training; their source licences and attribution are separate in the negative evidence report. No raw videos or landmark fixtures are shipped.
