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

Live capture defaults to direct, timestamped camera frames and a separate pose worker. The lab warms the GPU hand tracker before it opens the device. It retries on CPU if GPU preparation or the first camera frame stalls. The preview path remains available where direct capture is unsupported. File playback uses the pinned inline CPU tracker, as in the native training configuration.

For a matched diagnostic, set `SIGNRELAY_V2_CAPTURE` to `bitmap`, `snapshot` or `track`, and `SIGNRELAY_V2_VISION_PROFILE` to `gpu-on-demand` for inline pose or `gpu-split` for separate pose. `cpu-split` and `gpu-hands` provide CPU and hand-only controls. The console function `signRelayCameraDiagnostics()` returns a 600-frame timing and disposition ring and cumulative counts. Device-read IDs and compositor presentation IDs describe separate sampling points. Frame images and landmarks stay out of the trace.

Set `SIGNRELAY_V2_WARM_HAND=1` to use detector warm-up with an explicit GPU profile, or `0` to skip warm-up. Initialization uses a small neutral canvas before opening the camera. Check `signRelayCameraDiagnostics()?.startup` for load, warm-up and acquisition timings.

Use `training/make_asl_camera_fixture.py` for a local Y4M from a guarded recorded clip. Pass the original recording hash, generated Y4M and its sign interval to `diagnose-camera-fixture.py` to compare native detector coverage on the original and camera-fixture pixels. `browser-smoke.mjs` accepts the same guarded intake and fixture to measure the actual worker and camera interface. The ledger records the test inputs, clip-level outcomes and runtime versions.

```bash
node engine-v2/camera-pixel-probe-run.mjs "$CHROME" evaluation/raw/hand_landmarker.task \
  engine-v2/models/landmark.json evaluation/raw/v2-please.y4m evaluation/derived/paired-pixels.json
python engine-v2/camera-reel.py "$SOURCE" evaluation/raw/v2-dev-reel.y4m evaluation/derived/reel.json
node engine-v2/camera-reel-run.mjs "$CHROME" evaluation/raw/hand_landmarker.task \
  engine-v2/models/landmark.json evaluation/raw/v2-dev-reel.y4m evaluation/derived/reel.json \
  evaluation/derived/camera-reel-report.json "$AUTHORIZED_WARMUP_MP4"
```

The reel runner accepts an optional guarded local video warm-up. Keep the same warm-up in both runs when comparing capture or pose settings. It matches output to the signing intervals actually displayed by Chrome using the reel’s uniform gray padding. Generate a repeat reel with `camera-reel.py --repeat YES`. For a matched control, set `SIGNRELAY_V2_CALIBRATION_REPLAY=1` to run the original confirmation policy on the same tracker. Trials where no frames reached tracking are recorded as unobserved.

Set `SIGNRELAY_V2_REQUIRE_TARGETS=1` when running the supported and repeat reels as regressions. The runner requires exact target sequences and no suggestions in padding, and keeps the negative-trial results in the report.

Compare open-set policies with `evaluate-open-set.mjs` using the original training tracks and the exposed signer-disjoint development tracks. The training-only lower-tail margins are model-digest-bound. Set `SIGNRELAY_V2_REJECTION` to `baseline`, `fresh`, `calibrated` or `combined` in the camera replay. The last two require `SIGNRELAY_V2_CALIBRATION_FILE` pointing to the generated calibration JSON. `hard-negatives.py` freezes six additional licensed PopSign clips in ignored local storage. Build their separate local reel with `camera-reel.py --hard-negatives evaluation/derived/v2-native/open-set-hard-negatives.json`. These are development controls.

```bash
node engine-v2/evaluate-open-set.mjs engine-v2/models/landmark.json \
  evaluation/derived/v2-native/train.json evaluation/derived/v2-native/val.json \
  evaluation/derived/v2-native/open-set-calibration.json evaluation/derived/v2-native/open-set-dev-results.json
```

Use the [owner-operated webcam trials](WEBCAM-TRIALS.md) for a local, text-only development check. Use the [webcam evaluation protocol](../docs/evaluation/webcam-validation-protocol-2026-11-16.md) for a formal study. Preserve the final cohort until the acceptance policy is frozen.
