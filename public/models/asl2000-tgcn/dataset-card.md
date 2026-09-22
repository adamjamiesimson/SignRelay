# WLASL2000 Pose-TGCN browser model

This is a quantised browser export of the official WLASL2000 Pose-TGCN checkpoint published by the WLASL authors. It recognises 2000 isolated signs from 55 two-dimensional body-and-hand points across 50 temporal samples.

- Dataset and checkpoint: https://github.com/dxli94/WLASL
- Paper: https://arxiv.org/abs/1910.11006
- No performance claim is made for this browser export until it has a signer-independent evaluation.
- Terms: academic and computational use only; commercial use is not allowed.
- Privacy: raw WLASL videos and pose training samples are not included in the website. Live camera inference stays in the browser.

The live adapter maps MediaPipe landmarks to the OpenPose training contract. That domain change, the closed-set rejection gate, and real webcam conditions require separate evaluation, so SignRelay labels the feature experimental.
