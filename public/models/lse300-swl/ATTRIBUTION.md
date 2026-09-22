# Spanish Sign Language: SWL-LSE research model

This 300-class TemporalLandmarkNet was trained for SignRelay using the
[SWL-LSE / SignaMed release, version 1](https://doi.org/10.5281/zenodo.13691887).
Dataset creators: Manuel Vázquez-Enríquez, José Luis Alba-Castro, Ania
Pérez-Pérez, María del Carmen Cabeza-Pereiro, Laura Docío-Fernández,
Universidade de Vigo, Confederación Estatal de Personas Sordas, and FAXPG.
The release metadata declares [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
Please retain this attribution when redistributing these derived weights and labels.
The dataset creators do not endorse SignRelay.

Changes: the released legacy Holistic landmarks were shoulder-normalized,
resampled to 64 frames, and used to train a new compact temporal classifier.
These are SignRelay-trained weights, not the authors' baseline checkpoint.
The original 300 Spanish class labels and ordering are preserved, including
variant suffixes. No source video or signer landmark recordings are bundled.

Training used seed 42 and 24 CPU epochs. The checkpoint was selected by the
official validation split, and the official test split was evaluated after
selection. The split sizes were 6,348 training, 1,052 validation, and 600 test
sequences; duplicate files and cross-split file overlap were rejected.
Signer independence has not been separately established.

- Best validation top-1: 706 / 1,052 (67.11%).
- Test top-1: 363 / 600 (60.50%).
- ONNX: 3,509,107 bytes, SHA-256 `58ce0f861f7e095054386435bf1a506b933a68883befee60a33c163a152d0ae3`.
- [Training run and original artifact](https://github.com/adamjamiesimson/SignRelay/actions/runs/35179535121).

These figures measure precomputed dataset landmarks, not live camera accuracy.
SignRelay uses separate live MediaPipe trackers, a rolling buffer, motion gates,
and confidence filtering. Those differences need native-signer evaluation.
This is a health-domain isolated-sign research model, not a medical interpreter
or continuous translation system. Its 300 classes do not meet a 400-word goal.
