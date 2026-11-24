# BSL-1064 (BSL-1K Pose2Sign) pipeline audit — 24 November 2026

Baseline: `main` at `1b888fa`. Original model source: [gulvarol/bsl1k](https://github.com/gulvarol/bsl1k)
(`models/pose2sign.py`, `datasets/bsl1k.py`, `datasets/videodataset.py`, `misc/bsl1k/save_pose_info.py`,
`misc/bsl1k/extract_clips.py`, `evaluate.py`, `misc/bsl1k/bsl1k_vocab.pkl`), read from the public repository.

## 1. What the installed model is

| Item | Original (source) | SignRelay |
| --- | --- | --- |
| Checkpoint | `bsl1k_pose2sign_m8_l24_kws8_ps_bodyhands`: mouthing confidence ≥ 0.8, last 24 frames, pose subset, body + hands | same file, exported by `training/export_bsl1k_pose2sign_onnx.py` with `strict=True` weight loading |
| Architecture | 2D ResNet-18 blocks without a stem; input treated as a 3 × 16 × 60 "image" | identical module tree in the export script |
| Reported accuracy (README, BSL-1K test, pose subset) | 40.47 % top-1 / 59.45 % top-5 per instance; 20.24 % / 39.27 % per class | — (these are broadcast-interpreter numbers, not webcam numbers) |
| Labels | `bsl1k_vocab.pkl["words"]`, class id = `words_to_id[w]` | `labels.json` equals `upper(words)`; verified `words_to_id[w] == index` for all 1,064 words |

The original repository's own note is important context: Pose2Sign was a *cue-contribution* baseline, far
weaker than the RGB I3D model (75.5 % top-1). Even a perfect browser reconstruction cannot exceed it.

## 2. Contract comparison

| # | Aspect | Original | SignRelay `main` | Finding / action |
| --- | --- | --- | --- | --- |
| 1 | Body keypoint order | OpenPose COCO-18 | explicit MediaPipe → COCO-18 map | **Matches** (re-verified point by point, `tests/bsl-pose2sign-input.test.ts`) |
| 2 | Hand order | 21 OpenPose hand points, `lhnd` then `rhnd` | MediaPipe 21-point hands (same topology) | **Matches** |
| 3 | Hand identity | OpenPose crops each hand box *from its body wrist*, so `lhnd` = hand at the signer's anatomical left wrist | MediaPipe Tasks handedness label, trusted per frame | **Mismatch.** On real tracker output the label disagreed with the nearest body wrist on a measurable share of hand frames (REPORT.md). v2 assigns hands to body wrists (joint assignment for two hands; label fallback when ambiguous) |
| 4 | Undetected joints | OpenPose emits (0, 0, 0) | MediaPipe extrapolates off-screen hips/knees/ankles (e.g. y ≈ 1.8) and they were fed with a low score | **Mismatch.** v2 zeroes joints with visibility < 0.5 or outside the image |
| 5 | Coordinates | pixels / 480 on square-resized (480 × 480) signer crops | MediaPipe normalised image coordinates | Same *kind* of normalisation; **framing differs** (broadcast crop vs webcam). Not changed — needs BSL video to calibrate (see §4) |
| 6 | Third channel | OpenPose confidence | pose visibility; hands 1.0 | Different distributions; not changed (no evidence for a mapping) |
| 7 | Frame rate | 25 fps (`extract_clips.py`: `fps=25`) | whatever the camera loop delivers (≈ 20 Hz analysis cap) | **Mismatch.** 16 observed frames span ≈ 0.74–0.8 s instead of 0.6 s. v2 resamples to 25 fps |
| 8 | Window placement | clip = 64 frames ending at the mouthing time; last 24 used; 16 consecutive frames (random in training, sliding stride 8 at evaluation) — i.e. windows *over* the sign | last 16 observed frames at the moment the generic motion gate fires, which requires ≥ 230 ms of stillness | **Mismatch.** The window is the end of the sign plus the hold. v2 finds the movement span and evaluates stride-8 windows over it |
| 9 | Test-time aggregation | average of sliding-window outputs per video (`evaluate.py: aggregate_clips`) | single window | v2 averages window logits |
| 10 | Body pose cadence | every frame | pose refreshed ≥ 150 ms (every ~3rd frame) and *held* | Stair-stepped body motion. v2 interpolates between real pose refreshes |
| 11 | Tensor layout | `_get_pose(...).permute(2, 0, 1)` → [3, 16, 60] | channel-major [1, 3, 16, 60] | **Matches** (test) |
| 12 | Motion representation | raw positions only | raw positions | Matches; nothing added |
| 13 | Output use | top-1/top-5 classification | softmax ≥ 0.82 and margin ≥ 0.14, then two equal results **auto-confirmed into the transcript and speech** | **Policy problem.** Closed-set model output could enter the transcript and be spoken with no human check. Now a single reviewable suggestion per movement |
| 14 | Unknown signs | closed set (no reject class) | thresholds only | Unchanged; uncalibratable without BSL negatives |

## 3. Runtime, scheduling and UI findings

- **Repeated inference on the same sign.** While the gate stayed "ready", `main` re-ran the model every 6 frames on
  overlapping buffers; agreement between those near-identical inputs counted as "two independent" confirmations.
  Now: one decision per completed movement (rising edge of the gate), duplicate label suppression within 2.6 s.
- **First-sign latency.** The 46 MB model was only downloaded when the first sign completed. It is now warmed when
  BSL is selected; a sign completed during the download waits for it instead of being dropped.
- **Transcript/speech safety.** BSL model words now arrive as `suggestion` messages and use the existing "Add to
  transcript" control (no visual change). The page also refuses BSL `confirmed` messages unless they come from the
  signer's own personal templates.
- **Diagnostics.** `?perf` now shows BSL stage counters and the last decision with top-3, windows, sign frames,
  hand frames, hand-label corrections and the rejection reason. Nothing is uploaded or stored.
- **Frame rate.** Tracking is shared with every language (`VisionEngine`, unchanged). BSL inference cost is
  measured in REPORT.md; v2 runs one ONNX call per window (2–6 per sign).

## 4. Open questions that need BSL video

1. Framing/scale normalisation (row 5): whether re-centring/scaling a webcam signer towards BSL-1K crop statistics
   helps. Must be fitted on development BSL video and confirmed on separate signers — not guessed.
2. Confidence channel mapping (row 6).
3. Threshold calibration and unknown-sign rejection (row 14): needs supported, unsupported and non-sign BSL trials.
4. Whether v2 beats legacy at all on real BSL (adoption rule in PROTOCOL.md).
