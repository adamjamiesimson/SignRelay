# Display-oriented ASL sequence research weights

Independently trained with original SignRelay code in `training/fingerspelling/upright`, using Google / Deaf Professional Arts Network [FSboard version 13](https://www.kaggle.com/datasets/googleai/fsboard/versions/13), CC BY 4.0. No OpenFS code or weights were incorporated. These independently generated weights are distributed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

`fsboard-upright-v1.onnx`: 523322 bytes, 130,108 parameters, SHA-256 `34c823aef5eaa3e4b74c564138a1a224f8c9a8426e0f69a331d5c01fbf53008b`. Display matrices are applied before hand extraction, with preserved aspect ratio. 4,093 feasible training clips / 94 signers. Fresh 384-clip / 15-signer final: CER 11.7614%, 135/384 exact. This measures native-extracted display-oriented landmarks; physical-webcam accuracy remains unmeasured.

Research-only. No confidence threshold met the predeclared criterion. Ordinary hand actions still produce false candidates. Every displayed candidate is uncertain and requires deliberate review and confirmation. All prior checkpoints remain for rollback.

Provenance, predictions, calibration and reproduction: `docs/fingerspelling/ACCURACY-SPRINT.md` and `docs/fingerspelling/evidence/upright-*`. Licensed action negatives are evaluation-only and never enter these weights.
