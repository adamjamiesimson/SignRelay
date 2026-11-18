# SignRelay Engine V2 Lab

This standalone ASL lab processes camera and video files on the device. It uses timestamped hand observations, sparse upper-body context and a learned temporal classifier. The initial research vocabulary is **HELLO, THANK YOU, PLEASE, YES, NO**. Confirmed transcript insertion is outside this lab.

## Run the demonstrator

Use the repository’s locked Node dependencies and pinned pose runtime. Download the V2 hand detector from Google and keep it in the local evaluation directory.

```powershell
npm ci
npm run install:vision-assets
New-Item -ItemType Directory -Force evaluation/raw
Invoke-WebRequest 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task' -OutFile evaluation/raw/hand_landmarker.task
node engine-v2/serve.mjs evaluation/raw/hand_landmarker.task
```

Open http://127.0.0.1:8765, then select **Start camera** or **Open video**. File mode steps decoded frames at nominal 20 source samples per second and returns an isolated-clip result at the end. It accepts clips up to 15 seconds. Camera mode shows suggestions from causal overlapping windows and adds longer and shorter windows when analysis cadence falls. The displayed scores are logits. The analysis rate counts completed worker responses against elapsed wall time. The diagnostics include hand coverage, intentionally discarded frames and stage timing. A camera stop, tab hide, session change or worker fault releases the media resources. The server binds to loopback and checks vision asset fingerprints.

## Reproduce the lab

Restore the earlier authorized PopSign ASL v1.0 development intake and traces with the [Rebirth reproduction steps](../docs/evaluation/rebirth-reproduction.md). The V2 intake checks manifest and media fingerprints, duplicate recordings and signer separation. The dataset’s publisher and review status are preserved in the originating manifests. Only those development clips enter the experiment.

Set `SOURCE` to the Rebirth checkout, or to this checkout after restoring the development media and traces. Install Python 3.12 and the pinned packages from `training/asl-rebirth-requirements.txt`. Run native detection in the same offline environment used for the existing lab.

```bash
node engine-v2/prepare.mjs "$SOURCE" evaluation/derived/v2
python engine-v2/pixels.py evaluation/derived/v2/intake.json evaluation/derived/v2/pixels
node engine-v2/prepare.mjs "$SOURCE" evaluation/derived/v2 evaluation/derived/v2/pixels
python engine-v2/popsign_baseline.py evaluation/derived/v2 evaluation/derived/v2/popsign-baseline.json
python engine-v2/train.py evaluation/derived/v2 evaluation/derived/v2/control
python engine-v2/train.py evaluation/derived/v2 evaluation/derived/v2/aug --augment
node engine-v2/evaluate.mjs evaluation/derived/v2/val.json evaluation/derived/v2/control/landmark.json evaluation/derived/v2/control-landmark-stream.json
node --test engine-v2/core.test.mjs
```

The independent hand-detector experiment uses the same authorized frames and software versions. It runs Hand Landmarker and Pose Landmarker Lite at the V2 input size and writes into a separate cache.

```bash
python engine-v2/pixels.py evaluation/derived/v2/intake.json evaluation/derived/v2/pixels-v2 \
  --track evaluation/raw/hand_landmarker.task public/vision/models/pose_landmarker_lite.task
node engine-v2/prepare.mjs "$SOURCE" evaluation/derived/v2-native evaluation/derived/v2/pixels-v2
python engine-v2/train.py evaluation/derived/v2-native evaluation/derived/v2-native/aug --augment
python engine-v2/train.py evaluation/derived/v2-native evaluation/derived/v2-native/control-stream --mode landmark --calibrate-stream
node engine-v2/evaluate.mjs evaluation/derived/v2-native/val.json \
  evaluation/derived/v2-native/control-stream/landmark.json evaluation/derived/v2-native/control-stream.json
```

Pass the local Chrome executable path as `CHROME`. The matched probe uses native capture timestamps to seek through browser files. The control compares descriptors and logits with the offline path when both receive identical observations. The media probe records tracking and feature differences separately. For independent V2 detector weights, pass the corresponding development file as the last argument.

```bash
node engine-v2/forensics.mjs "$SOURCE" "$CHROME" evaluation/raw/hand_landmarker.task \
  evaluation/derived/v2/forensics-control.json evaluation/derived/v2/control/landmark.json \
  evaluation/derived/v2/control/landmark-parity.json
```

For throughput comparisons set `SIGNRELAY_V2_VISION_PROFILE` to `cpu-on-demand`, `gpu-on-demand` or `gpu-framewise` in the environment before starting the demonstrator. These are diagnostic configurations. The default CPU profile matches the native training configuration.

Use `training/make_asl_camera_fixture.py` for a local Y4M from a guarded recorded clip. Pass the original recording hash, generated Y4M and its sign interval to `diagnose-camera-fixture.py` to compare native detector coverage on the original and camera-fixture pixels. `browser-smoke.mjs` accepts the same guarded intake and fixture to measure the actual worker and camera interface. The ledger records the test inputs, clip-level outcomes and runtime versions.

The held back test and human webcam trials require the existing [webcam protocol](../docs/evaluation/webcam-validation-protocol-2026-11-16.md). Keep model selection on the development data. Record signer and device conditions, review sign identity and boundaries, and include consecutive signs and ordinary movement with consent. Preserve the final cohort until there is a credible candidate and a frozen acceptance policy.
