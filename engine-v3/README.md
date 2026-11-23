# SignRelay Engine V3 — isolated ASL sign recognition (500+ classes)

Engine V3 research source and history are preserved here. The normal SignRelay ASL workspace integrates the frozen V3.1 checkpoint through `lib/asl-v31-runtime.ts` and the main recognition worker. The standalone lab remains a research reference. Start application development with [the developer handoff](../docs/DEVELOPER_HANDOFF.md).

* **Decision record:** [RESEARCH-DECISION.md](RESEARCH-DECISION.md)
* **Results:** [REPORT-V3.1.md](REPORT-V3.1.md) (current: V3.1 model, camera path, holdout-2), [REPORT.md](REPORT.md) (V3.0) and `ledger/` (machine-readable evaluation reports)
* **Live lab:** https://signrelay-v3-lab.vercel.app (experimental; see [DEPLOYMENT-V3.1.md](DEPLOYMENT-V3.1.md))
* **Models:** `models/v3.1/` (current, frozen) and `models/v3.0/` (preserved)
* **Vocabulary:** [vocabulary/](vocabulary/) — frozen policy, class manifest

## Layout

| Path | Purpose |
| --- | --- |
| `pipeline/list_popsign.py` | Index PopSign ASL v2.1 from the official HTTPS listing (no video bytes) |
| `pipeline/plan.py` | Deterministic signer-round-robin extraction tranches |
| `pipeline/extract.py` | Download → SHA-256 → ffprobe → ffmpeg (15 Hz, long side 480) → MediaPipe Tasks 0.10.35 (Hand ×2, Pose Lite, Face) → `.npz`; resumable, logs every exclusion |
| `pipeline/build_cache.py` | 86-point gather (same rule as the browser), SHA-256 de-duplication across splits |
| `pipeline/points.py` | Landmark contract shared with the browser |
| `train/v3model.py` | `prepare_clip`, in-graph `Featurizer`, Convformer / GRU encoders |
| `train/train.py` | Resumable CPU training with augmentation (speed, mirror, affine, low-frame-rate camera simulation, landmark dropout) |
| `train/evaluate.py` | Calibration (temperature + open-set policy on validation only), reports, sealed-test guard |
| `train/export_onnx.py` | ONNX export + PyTorch/ONNX Runtime verification on real clips |
| `web/` | Static lab: MediaPipe Tasks WASM + ONNX Runtime Web in a worker; `preprocess.mjs` mirrors the Python preprocessing |
| `parity/` | JS≡Python preprocessing test, Chrome video-file runner, native-vs-Chrome comparison, Chrome fake-camera replay |

## Reproduce

Requirements: Python 3.13 with `mediapipe==0.10.35 numpy torch scikit-learn onnx onnxruntime`, ffmpeg,
Node 22 with the repository's `npm ci`, Playwright Chromium (for parity tests). Linux needs `libgles2 libegl1`.

```bash
D=/path/to/data            # outside the repository
python engine-v3/pipeline/list_popsign.py $D/popsign/index.json
python engine-v3/pipeline/plan.py $D/popsign/index.json $D/popsign
# models: hand_landmarker.task, pose_landmarker_lite.task, face_landmarker.task (SHA-256 pinned in web/build.mjs)
SIGNRELAY_MODELS=$D/models python engine-v3/pipeline/extract.py $D/popsign/plan-A-train-r0-s0-10.json $D/lm --workers 4
#   … repeat for every tranche listed in REPORT.md (resumable; finished clips are skipped)
cd engine-v3/pipeline && python build_cache.py $D/lm $D/cache train val test && cd ../train
python train.py --cache $D/cache --out $D/runs/<name> --kind convformer --epochs <N>
python evaluate.py prototypes --run $D/runs/<name> --cache $D/cache --out $D/runs/<name>/protos.npy
python evaluate.py calibrate  --run $D/runs/<name> --cache $D/cache --out $D/runs/<name>/policy.json
python evaluate.py report     --run $D/runs/<name> --cache $D/cache --split val --policy $D/runs/<name>/policy.json --out val.json
python export_onnx.py --run $D/runs/<name> --out ../models/<version> --policy $D/runs/<name>/policy.json --cache $D/cache
node ../web/build.mjs ../models/<version> && node ../web/serve.mjs ../web/dist 8790
```

The exact commands, hardware and timings of the runs reported in `REPORT.md` are recorded in
`ledger/experiments.jsonl`.

## Data and licences

* Training data: **PopSign ASL v2.1** (Starner et al., Georgia Tech / DPAN), CC BY 4.0. Weights derived from it
  are distributed with attribution. Raw videos and landmark caches are never committed.
* Non-vocabulary motion negatives: **FSBoard** fingerspelling (Google), CC BY 4.0.
* External evaluation only: **ASL Citizen** (Microsoft Research licence, non-commercial research use, no
  redistribution). Never used for training; its videos and landmarks stay outside the repository; only
  aggregate metrics are reported.
* Landmark models: Google MediaPipe Tasks (Apache-2.0).

## Optional historical Playwright runners

The application and its standard browser checks use the root npm installation and system Chromium. Install the separate research runner dependencies only when using the historical Playwright parity scripts.

```sh
npm ci --prefix engine-v3/parity
npm exec --prefix engine-v3/parity -- playwright install chromium
```

This replaces the upstream workstation-specific dependency symlink. No external machine path is needed.
