# Engine V3.0 model (frozen)

* `model.onnx` — ensemble of two Convformer seeds (mean log-probabilities; concatenated normalised embeddings).
  Inputs `x [B,48,86,3]`, `valid [B,48,86]`, `fmask [B,48]`; outputs `logits` (523 signs + UNKNOWN, as
  log-probabilities) and `embedding`. Face points are not used (masked) — see the face ablation in the ledger.
* `meta.json` — class list, preprocessing contract, ONNX verification, default (balanced) decision policy, class prototypes.
* `policy-balanced.json` / `policy-strict.json` — decision presets fitted on validation signers and calibration-only unknown signs.
* `FREEZE.json` — fingerprints committed **before** the sealed test was evaluated.
* Class manifest: [`../../vocabulary/classes-v3.0.json`](../../vocabulary/classes-v3.0.json).

These weights are derived from **PopSign ASL v2.1** (Thad Starner et al., Georgia Institute of Technology and the Deaf
Professional Arts Network), licensed **CC BY 4.0** (https://creativecommons.org/licenses/by/4.0/), and FSBoard
(Google, CC BY 4.0) windows used as non-vocabulary negatives. No ASL Citizen data were used to train them.
