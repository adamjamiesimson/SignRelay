# SignRelay Engine V3.1 model attribution

SignRelay trained this isolated ASL checkpoint from MediaPipe landmarks derived from PopSign ASL v2.1 and FSBoard. The checkpoint ensembles two Convformers and was exported to ONNX. The weights, metadata, and both calibrated rejection policies are copied byte-for-byte from the frozen model in SignRelay PR #65 at `ea4e5432df811fcfb91db926b741d21b12222098`. [Training and evaluation report](https://github.com/adamjamiesimson/SignRelay/blob/ea4e5432df811fcfb91db926b741d21b12222098/engine-v3/REPORT-V3.1.md)

- **PopSign ASL v2.1**, Starner et al., Georgia Tech and the Deaf Professional Arts Network. Training used tranches A, B and D of the published training split. [Dataset](https://signdata.cc.gatech.edu/data/popsign_v2_1/game/) · [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- **FSBoard**, Google. Training used 600 fingerspelling windows as UNKNOWN examples. [Dataset](https://huggingface.co/datasets/google/fsboard) · [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- **MediaPipe Tasks**, Google. The browser uses the separately pinned Hand Landmarker and Pose Landmarker Lite models from the official distribution. [MediaPipe](https://github.com/google-ai-edge/mediapipe) · [Apache 2.0](https://www.apache.org/licenses/LICENSE-2.0)

ASL Citizen contributed to evaluation only. No source recordings, signer data, or landmark caches ship with this checkpoint.
