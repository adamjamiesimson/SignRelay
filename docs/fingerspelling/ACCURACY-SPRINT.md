# ASL fingerspelling: accuracy and real-world reliability

**Readiness: research-only.** SignRelay now runs a genuine, independently trained sequence recogniser through the existing capture → worker → candidate → deliberate confirmation flow. Confidence calibration did not establish an operating threshold. Ordinary hand actions still yield text. Physical-webcam and independent Deaf-user validation remain outstanding.

## Fresh, matched recognition evidence

All three checkpoints below were evaluated on the **same 384 fresh clips / 15 test signers / 5,416 reference characters**, with correct display orientation. These figures use native-extracted hand landmarks; complete browser RGB results are reported separately below. Final signers are disjoint from training, development and calibration. No final clip was discarded for tracking quality.

| Checkpoint / decoder | CER | Exact sequences | WER |
|---|---:|---:|---:|
| Original 512-clip GRU / greedy | 38.15% | 3/384 (0.78%) | 99.88% |
| Previous expanded motion GRU / beam 8 | 18.15% | 68/384 (17.71%) | 74.13% |
| Corrected display-aware GRU / greedy | 12.20% | 126/384 (32.81%) | 57.16% |
| **Corrected display-aware GRU / beam 8** | **11.76%** | **135/384 (35.16%)** | **55.11%** |

Selected model: **637 edits = 172 substitutions + 270 deletions + 195 insertions**. Signer-bootstrap 95% CER interval **7.77–16.24%**; exact-match interval **25.39–44.79%**. The paired original-checkpoint-minus-selected CER interval is 25.43–27.64 percentage points. Bootstrap resamples signers, not frames. The previous motion model recovers 68/136 repeated adjacent-letter pairs; the corrected model recovers **104/136 (76.47%)**.

[Every hypothesis, edit count, confidence result and stratum](evidence/upright-final.json) · [locked selection](evidence/upright-selection.json) · [training curves and environment](evidence/upright-training.json).

The initial expanded model's earlier **12.40% CER / 118 of 384 exact** used a different final cohort and OpenCV's coded-frame orientation. That result is retained in [the earlier evidence](evidence/accuracy-v2-final.json); it is not a webcam accuracy claim and must not be compared as if it used the current cohort. The corrected final set excludes every clip in the original pilot and earlier expanded experiment.

## The orientation failure and corrected contract

A real RGB virtual-camera test initially produced zero inference candidates. Native replay of the **exact worker-input pixels** reproduced the tracking failures. The source MP4s carried a 90° display matrix: OpenCV extraction supplied sideways coded frames, while FFmpeg applied the display rotation. A fixed 640×360 camera fixture then stretched the upright portrait image. RGB thumbnail error against coded frames was about 60/255; warmup/history ablations did not resolve it.

The corrected pipeline applies the source display matrix **before** landmark extraction and preserves displayed aspect ratio, with max side 640. In the 5,248-clip corrected cache, **4,790 files carry 90° rotation**, 458 carry zero rotation; decoded display dimensions are 360×640. [Per-clip source/rotation/hash provenance](evidence/upright-provenance.json.gz) · [RGB inventory](evidence/upright-rgb-inventory.json). FFmpeg version is recorded per clip. Native source PTS comes from monotonic best-effort decoded timestamps relative to stream start, never nominal index/FPS.

MediaPipe Tasks **0.10.35** official GestureRecognizer task: 8,373,440 bytes, SHA-256 `97952348cf6a6a4915c2ea1496b4b37ebabc50cbbf80571435643c455f2b0482`. CPU, VIDEO mode, two hands; detection/presence/tracking thresholds .55. Canned-gesture labels are ignored and their classifier options remain at defaults. Fingerspelling has a dedicated hand-only worker; it does not run face/pose or fall back to GPU/main-thread inference. The original word vision/recognition workers retain their existing path.

Ordering: wrist 0, thumb 1–4, index 5–8, middle 9–12, ring 13–16, little 17–20. Only normalized **image** landmarks are used; world landmarks are excluded. x is width-normalized, y height-normalized, z width-scaled depth relative to wrist. See [Google's task output documentation](https://developers.google.com/edge/mediapipe/solutions/vision/gesture_recognizer/web_js).

The unchanged v3 feature math produces float32 `[T,132]`: wrist-relative hand xyz (0–62), wrist trajectory xy (63–64), adjacent hand deltas (65–127), trajectory deltas (128–129), presence (130), observed dt ×15 clipped to [0,3] (131). Convert y to width units; divide hand coordinates by the median 3D wrist-to-MCP distances at 5,9,13,17, floor 1e-4; trajectory is relative to the first visible wrist and uses the sequence median scale. Motion deltas are multiplied by (1/15)/observed-dt; the first frame and deltas across missing observations are zero. Flip x for returned-Left. Preserve palm orientation; arbitrary rotation normalization would erase meaningful distinctions. Missing observations and velocities across gaps are zero; coordinates/deltas clip to ±8.

Browser capture uses distinct decoded frame identity and `requestVideoFrameCallback.mediaTime`, mapped affinely to the performance clock. CPU completion can schedule the next due frame without losing another animation tick. No duplicate frames or uniform-grid samples are manufactured for the active model. Capture targets 15 Hz; requires ≥12 observed Hz, max gap 200 ms, ≥60% visibility of one returned hand category, stable aspect, 1–16 seconds and max 320 frames. Returned handedness is a model category, not verified physical dominance. Preview CSS mirroring does not change inference pixels.

## Data, architecture and provenance

Dataset: [Google / Deaf Professional Arts Network FSboard v13](https://www.kaggle.com/datasets/googleai/fsboard/versions/13), **CC BY 4.0**. Original SignRelay preprocessing/training code and independently generated weights; **no OpenFS code or checkpoint** was incorporated. The [OpenFS released-code/checkpoint licence](https://github.com/AIRC-KETI/OpenFS/blob/main/LICENSE) limits both to non-commercial research/education and reserves other uses for written permission. Compatibility with general SignRelay use was not established, so its code and checkpoints were excluded. No separate OpenFS inference benchmark is claimed.

Training expanded from 512 to **4,093 feasible clips / all 94 training signers**, selected from 4,096; three training-only CTC/tracking-infeasible examples were excluded. There are no novel-to-project signers in the released annotated splits: all 94/15/15 publisher train/validation/test signers were previously sampled. Generalisation evidence is therefore training-disjoint signers and fresh clips, not newly recruited people.

| Role | Clips | Signers | Purpose |
|---|---:|---:|---|
| Training | 4,096 selected / 4,093 used | 94 | Fit weights |
| Development | 256 | 8 | Checkpoint selection |
| Calibration fit | 192 | 3 | Conditional exact-correctness fit |
| Calibration policy | 192 | 3 | Predeclared threshold check |
| Primary final | 384 | 15 | Once-opened comparison |
| Separate returned-Left final | 32 | 1 | Limited category diagnostic |
| Rare/double challenge | 96 | 14 | Separate clips, never pooled into primary final |

Eligibility: non-sensitive publisher-labelled fingerspelling; 3–32 uppercase ASCII letters/spaces, 1–16-second annotations, source ≤40 MiB. Training excludes selected held-out exact phrases. Every held-out clip excludes both earlier experiments' provenance. Train/dev/calibration/final signer separation is asserted. Left signer `1c15` is excluded from this sprint's train/dev/calibration but appeared in the historical model's validation; physical handedness is unverified.

Training includes Q 178, X 161, U 1,365, J 531 and Z 342 reference characters; 3,308 returned-Right / 785 returned-Left clips. Weighted distinct-clip sampling favours rare letters/doubles, without inventing frame labels. The largest observed difference between nominal-index time and decoded PTS was .366 seconds. Raw publisher size/MD5 and independently recorded SHA-256 are checked before decoding; cached feature SHA-256 is checked on every load. TLS and integrity validation remain enabled. Raw media/keypoints are not committed.

The [earlier controlled, coded-frame experiment](https://github.com/adamjamiesimson/SignRelay/actions/runs/41274581796) compared:
| Controlled candidate | Parameters / bytes | Dev greedy / beam CER |
|---|---:|---:|
| Expanded v2 GRU | 123,772 / 497,976 | 15.59 / 14.48% |
| Motion v3 GRU | 130,108 / 523,322 | 13.17 / 12.60% |
| Motion v3 temporal CNN | 76,156 / 313,722 | 13.63 / 13.00% |

That development-only choice fixed the corrected model's architecture and beam decoder **before** its fresh final set was opened. The data/regularisation/augmentation changes in the first row are combined; their separate causal effects are not established. The temporal CNN uses six masked residual depthwise layers, dilations 1–32.

Current model: width-96 bidirectional GRU, 132 features, dropout .2, AdamW LR .001 / decay .003, batch 32, clip norm 5, plateau LR schedule, 80-epoch cap and eight non-improving development checks for early stopping. Augmentation: speed .8–1.25, coordinate jitter, mild anisotropic scaling and occasional missing bursts. These perturbations are not real negative data. Best epoch **47**; train greedy CER **4.58%**, dev greedy **13.15%**, dev beam **12.80%**; 904.4 seconds on Python 3.11.17 / Torch 2.5.1+cpu, two threads. The residual train/dev gap remains.

FSboard supplies sequence transcripts, not frame-level letter labels. A frame classifier cannot be honestly supervised by assigning each frame its sequence label, and cannot resolve J/Z or repetitions alone. CTC learns alignment with blank; the visual prefix beam preserves blank-separated doubles and collapses held letters. **No dictionary, language model, name lookup or phrase correction** is used. The model predicts a complete captured sequence after Finish.

[Corrected data: eight successful shards](https://github.com/adamjamiesimson/SignRelay/actions/runs/41281739421) · [fixed-architecture training, selection, calibration and fresh final](https://github.com/adamjamiesimson/SignRelay/actions/runs/41285144707). Frozen plan SHA-256: `56d12a13b86ca92d94e397c4cc65fe7f55d8a154d8a6b56a3f42b25a483217e7`. The first bounded cache wait expired before the last shards completed; it never trained or opened final data. The successful run requires all eight completed shards.

## Recognition coverage

All 26 letters have aligned correct primary-final instances. This does not certify A–Z support. Q is 6/9; its descriptive Wilson interval remains 35.4–87.9%. Primary returned-Left has only two clips and CER **91.67%**, both non-exact. The separate 32-clip / one-returned-Left-signer set scores **6.96% CER, 16/32 exact**, without a signer-generalisation interval. These results do not establish physical-left reliability.

| Letter | Aligned correct / total | Recall | Descriptive Wilson 95% |
|---|---:|---:|---:|
| A | 595/629 | 94.6% | 92.5–96.1% |
| B | 77/82 | 93.9% | 86.5–97.4% |
| C | 211/228 | 92.5% | 88.4–95.3% |
| D | 155/162 | 95.7% | 91.4–97.9% |
| E | 406/434 | 93.5% | 90.8–95.5% |
| F | 64/70 | 91.4% | 82.5–96.0% |
| G | 95/103 | 92.2% | 85.4–96.0% |
| H | 131/136 | 96.3% | 91.7–98.4% |
| I | 387/396 | 97.7% | 95.7–98.8% |
| J | 31/35 | 88.6% | 74.0–95.5% |
| K | 72/75 | 96.0% | 88.9–98.6% |
| L | 300/317 | 94.6% | 91.6–96.6% |
| M | 137/147 | 93.2% | 87.9–96.3% |
| N | 395/417 | 94.7% | 92.1–96.5% |
| O | 338/364 | 92.9% | 89.7–95.1% |
| P | 57/66 | 86.4% | 76.1–92.7% |
| Q | 6/9 | 66.7% | 35.4–87.9% |
| R | 342/363 | 94.2% | 91.3–96.2% |
| S | 276/308 | 89.6% | 85.7–92.5% |
| T | 216/235 | 91.9% | 87.7–94.8% |
| U | 96/111 | 86.5% | 78.9–91.6% |
| V | 67/71 | 94.4% | 86.4–97.8% |
| W | 65/70 | 92.9% | 84.3–96.9% |
| X | 25/30 | 83.3% | 66.4–92.7% |
| Y | 85/89 | 95.5% | 89.0–98.2% |
| Z | 19/22 | 86.4% | 66.7–95.3% |

These are reference-character edit-alignment recalls, not independent frame-class accuracy. Insertions are counted separately in CER. Repeated pairs improve 50.0→76.47% against the previous motion checkpoint. Separate challenge: 9.33% CER, 46/96 exact. Natural speed bins: <2 reference chars/s, 23 clips, 15.99% CER; 2–4, 274 clips, 10.74%; ≥4, 87 clips, 14.00%. Full confusions and per-signer predictions are in the final JSON.

## Calibration and real negatives

L2 logistic calibration uses seven visual summaries and estimates exact correctness **conditional on fingerspelling input**. Fit split: 188 quality-eligible sequences, 25 correct, three signers. On separate policy signers, Brier **.2632**, ECE10 **.2086**; probabilities under-estimate observed exactness. None of the .50–.95 grid accepts any policy example. The predeclared requirement was ≥20 accepted and Wilson lower bound ≥.80. **No threshold qualifies.** Calibration is not an operating guarantee.

The deployed threshold remains null; every displayed candidate is `uncertain`. Structurally invalid captures abstain; eligible raw candidates require deliberate confirmation and can be edited. Nothing is inserted or spoken automatically. Qualified coverage is zero on positives as well as negatives: **0/29 qualified false accepts is vacuous, not a safety improvement**.

29 predetermined real action windows from five separately licensed Wikimedia videos, conservatively grouped into only two source groups: handwashing/rubbing, clothing/items, mask/face actions, lexical ASL. Both prior and corrected motion checkpoints produce **6/29 candidates after matched hand/frame checks**; both produce 5/15 in the subset with visible action across sampled frames. The corrected model produces nonempty raw logits on all 29 before no-hand/quality guards. Five negative strings also meet the research UI's length bounds and remain flagged uncertain. No improvement in ordinary-movement rejection is established.

[Negative sources/licences/SHA pins](../../training/fingerspelling/accuracy/negative-sources.json) · [full negative outputs](evidence/upright-negatives.json) · [five-frame-per-window AI review](../../training/fingerspelling/accuracy/negative-review.json). CDC public-domain/CC BY-SA 4.0 and Fuzheado/Andrew Lih CC BY-SA 3.0 material is **evaluation-only**, never used in weights or threshold fitting. Edited clips, unverified identities and limited AI temporal review prevent a population or independently expert-labelled false-accept claim. The ASL demo's source captions identify lexical intervals before its alphabet demonstrations.

## Browser evidence

ONNX opset 17; **523,322 bytes / 130,108 parameters**, SHA-256 `34c823aef5eaa3e4b74c564138a1a224f8c9a8426e0f69a331d5c01fbf53008b`. Same-origin streaming fetch verifies size and SHA before worker-only WASM inference. Both previous checkpoints remain unchanged for rollback.

[Paired real-sequence browser run](https://github.com/adamjamiesimson/SignRelay/actions/runs/41298340341) / [all measurements](evidence/upright-browser.json): eight genuine held-out sequences, same native/browser beam text; Python/JS feature difference **0** on these samples, native/browser max logit error **7.63e-6**, probability implementation error ≤2.04e-7. Actual inference-worker reset/latest-request checks pass; immediate reset demonstrates stale-result protection, not measured termination midway through a native kernel.

Fresh Chrome profiles, Linux x86-64 / Headless Chrome 156, same eight inputs, 40 warm genuine inferences per checkpoint:
| Measurement | Previous motion | Corrected motion |
|---|---:|---:|
| Warm ONNX median / p95 | 1.1 / 1.9 ms | 1.1 / 1.9 ms |
| Inference + decode/checks median / p95 | 3.0 / 16.1 ms | 2.3 / 5.1 ms |
| Single observed runtime/model load | 698.2 ms | 545.4 ms |
| Warm Chrome process-tree PSS | 512.3 MiB | 515.3 MiB |
| PSS rise before load → warm | 148.0 MiB | 141.7 MiB |

This bare-runtime benchmark excludes camera tracking and full-app memory. PSS apportions shared pages; it is not WASM-only allocation or peak physical-device memory. Single load observations do not establish a speed gain.

### Actual RGB → getUserMedia → production tracking → CTC → confirmation

[First complete ten-case run](https://github.com/adamjamiesimson/SignRelay/actions/runs/41299001840) / [machine-readable evidence](evidence/upright-camera.json). **No injected landmarks**: genuine licensed FSboard recordings become an aspect-preserving 360×640, 30 FPS virtual camera. The actual CPU vision worker extracts hands; the actual sequence worker infers; the interface displays an uncertain candidate; deliberate Confirm appends it. All ten candidates exercised confirmation, no automatic composition/speech, and preservation of the word transcript.

| Reference | First complete RGB run | Identical-catalog repeat | Cohort |
|---|---|---|---|
| PLUSS | PLUSS | PLUSS | known |
| ESTEVAN WONG | ESTEVAN WONG | ESTEVAN WONG | known |
| EDINBURG TX | EDIN BURGTX | EDIN BURGTX | held-out |
| LAS VEGAS NV | LAS VEGAS NV | LAS VEGS N | held-out |
| RENITA CAMPOS | RENITA CAMPOS | RENITA CAMPOS | held-out |
| NEWPORT NEWS VA | NEWGPOUTHNEWSVA | NEWOUTNE WSYVA | held-out |
| FORT WAYNE INDIANA | FORTWAINNINDFORTWAINEINDIANA | FRTWAINNINDFORTWAINEINDIANA | held-out |
| KANSAS CITY KS | KANSAS CITYKS | KANSAS CITYKS | held-out |
| CHESAPEAKE VA | CHESAQEA KEVA | CHESAQEA KEVA | held-out |
| MICHAEL CAMACHO | MICHAEL CAMACHO | MICHAEL CAMACHO | held-out |

The **eight fixed held-out recordings / six signers** score **24/111 edits = 21.62% CER, 3/8 exact**, with zero quality abstentions. Both known regressions are exact in that complete run. The **same eight native-landmark fixtures** score **23/111 edits = 20.72% CER, 3/8 exact**. These eight are a small convenience subset, including two separate returned-Left clips; they are harder than the 384-clip primary cohort. Comparing 11.76% on all 384 directly with 21.62% on these eight would confound input path with cohort.

[Repeat after warning-copy-only change](https://github.com/adamjamiesimson/SignRelay/actions/runs/41299269613) / [all repeat results](evidence/upright-camera-repeat.json): **27/111 edits = 24.32% CER, 2/8 exact** on the same eight; both known regressions exact again. Capture delivered about 14.12–15.00 Hz in the first complete run and 13.24–14.17 Hz in the repeat. The Las Vegas prediction changed. No weights, thresholds, decoder or capture gates were retuned. These are correlated replay measurements, not sixteen independent withheld examples.

The earlier [partial run](https://github.com/adamjamiesimson/SignRelay/actions/runs/41298557504) produced **PLUSSS for PLUSS**, then stopped when FFmpeg consumed the case-list stdin. That wrong result is [retained separately](evidence/upright-camera-prior-attempt.json), without assigning an accuracy denominator to unrun cases. The harness now loads the complete fixed catalog into an array and gives video tools null stdin. Sampling/timing sensitivity remains visible.

The exact app-captured 132-feature tensors decode to **identical native ONNX text in all 10/10 cases, in both complete runs**. This establishes neural-runtime parity on actual capture input, not identical native/browser tracking. The current-model full camera cases do not contain reference J, Q or Z; native sequence recalls for those letters must not be described as webcam coverage.

First complete run: tracking median 54.0–55.8 ms per case; first/cold sequence inference 20.6–28.0 ms; **Finish → visible DOM candidate 27.6–34.8 ms**, 33.8–41.0 ms in the repeat. **Capture start → visible candidate 2.578–6.731 seconds**, including actual gesture duration. These are remote Linux/Chrome observations, not user-device or physical-camera measurements. Model/vision startup and physical-device memory remain unmeasured.

### Identical-pixel tracking and mirroring

[Display-oriented CPU RGB parity run](https://github.com/adamjamiesimson/SignRelay/actions/runs/41282399236) / [full points-error summary](evidence/upright-production-rgb.json): three genuine clips, original and horizontally mirrored, **414 lossless RGB frames individually SHA-verified in the browser** against native input, identical decoded timestamps up to a constant +2 ms startup offset. Matched returned categories agree. Points are **not bit-identical**: per-case mean xy error .100–.945 pixels, maximum 20.29 pixels; two browser-only hand observations occur. Using the same original 66-feature checkpoint on each extracted sequence yields matching native/browser text in 6/6 variants. That old-checkpoint decode isolates extraction; it does not establish current-model J/Z or mirror accuracy. Current-model shared-landmark parity and captured-tensor parity are measured separately above.

The **two known real-landmark app replays** additionally pass worker integration, reset, confirmation/cancel, mode switching and native captured-input checks, but predict PLUSSS and STEVAN WONG. Their source images are not processed in that point-replay path. They remain software/inference integration evidence rather than full camera accuracy.


## Reproduce on a separate Linux runner

```bash
sudo apt-get update
sudo apt-get install -y libgles2 libegl1 libgl1 ffmpeg
python3.11 -m venv work/asl-venv
. work/asl-venv/bin/activate
python -m pip install -r training/fingerspelling/requirements.txt
python -m pip install torch==2.5.1 --index-url https://download.pytorch.org/whl/cpu
python training/fingerspelling/upright/data.py --plan-only
for shard in 0 1 2 3 4 5 6 7; do
  python training/fingerspelling/upright/data.py --shard "$shard" --shards 8
done
export ACCURACY_PLAN_SHA256=56d12a13b86ca92d94e397c4cc65fe7f55d8a154d8a6b56a3f42b25a483217e7
export UPRIGHT_CACHE_SOURCE="${GITHUB_SHA:-local-reproduction}"
python training/fingerspelling/upright/train.py --experiment motion_gru_v3 --epochs 80 --batch 32
python training/fingerspelling/upright/freeze.py
python scripts/diagnostics/fingerspelling-negative-prepare.py
python training/fingerspelling/upright/evaluate.py
npm ci
node scripts/copy-onnx-runtime.mjs
node scripts/diagnostics/fingerspelling-upright-browser.mjs "$(command -v google-chrome)"
```

Best and last optimiser/scheduler/Torch-RNG checkpoints support `--resume`; interrupted-versus-uninterrupted equality was not separately measured. Artifacts retain cache/checkpoints for 14 days. Committed weights, predictions, source/rotation/hash provenance and reports survive expiry. Rebuilding requires about 32 GB of verified source downloads; changed native libraries/hardware can change retrained bytes. The evaluated distributed weights are independently byte-pinned.

For the committed app checkpoint, run `npm run build:rehearsal`, `python scripts/diagnostics/fingerspelling-app-prepare.py`, then `node scripts/diagnostics/fingerspelling-app-replay.mjs "$chrome"`. The [RGB workflow](../../.github/workflows/fingerspelling-replay.yml) provides the fixed-case generator, real-video conversion, camera capture and exact captured-tensor native checks. The [RGB parity workflow](../../.github/workflows/fingerspelling-rgb.yml) verifies decoded pixel hashes and native/browser tracking.

Rollback is one assignment in `lib/fingerspelling-model.ts`: choose `FINGERSPELLING_ACCURACY_MODEL` for the previous motion model or `FINGERSPELLING_BASELINE_MODEL` for the original 66-feature model, then rebuild workers/app. Capture selects that contract's feature version. Neither rollback is a validated public recogniser.

## Software validation and preserved systems

[Isolated verification](https://github.com/adamjamiesimson/SignRelay/actions/runs/41299269564): **1,007 passed / two existing skips / zero failures**, typecheck, lint, worker builds, asset/repository guard and eight browser controller/privacy/lifecycle checks pass. These are software checks, not 1,007 recognition examples. [Offline/fault-injection smokes](https://github.com/adamjamiesimson/SignRelay/actions/runs/41299273673), [analytics consent](https://github.com/adamjamiesimson/SignRelay/actions/runs/41299273610) and [standalone frozen-selection reproduction](https://github.com/adamjamiesimson/SignRelay/actions/runs/41299269608) pass. The last verifies the helper recreates the exact pre-final selection and evaluated model bytes; it does not rerun training or reopen final data.

[Protected-file audit](evidence/upright-preservation.json): **804 protected baseline blobs unchanged**, zero unexpected modifications/additions outside the explicitly scoped fingerspelling/live-camera/UI/tooling paths. Original logo, styles/brand, word recognition/vision worker sources and word models, security audits, lockfile and Firebase configuration remain byte-identical to sprint baseline `953825e0ff0dce35ce732c0ced449e5d4fc3561f`. Dependencies/devDependencies are identical; only the worker-build script changed. Compiled word recognition worker remains SHA-256 `ec7b6d01b89467339b1a957c1f8714d8a4044a23b24a751ad4fe2a403a7aa557`.

**Global CI is not green.** [Core CI](https://github.com/adamjamiesimson/SignRelay/actions/runs/41299273797) and [Firebase static-build gate](https://github.com/adamjamiesimson/SignRelay/actions/runs/41299273704) retain the inherited strict audit failure: 16 moderate development findings, zero production findings, unreviewed minimatch advisory GHSA-g3hv-75wg-m249. The separate [PopSign video pilot](https://github.com/adamjamiesimson/SignRelay/actions/runs/41299273728) still rejects the distrusted emSign G3 certificate hierarchy. Neither audit nor TLS policy was changed or waived.

Cache extractor source: `94d22b0dee20c5762f14f00e4554a0c869d81ec8`; successful training/evaluation source: `37f2ee03cde79422a4792ebff910f823994b1ee2`; first complete RGB source: `075546f0382e82ef41c8e8dee01034c750bb5dff`; warning-copy/reproduction validation source: `bb6d30f677b643449d15947452b75f532e1a9dbc`. Later report-only commits do not change runtime, weights, preprocessing or capture behaviour. The training source now additionally accepts an explicit cache-source override for genuine local/CI reproduction; the original pinned default and frozen plan remain unchanged.

PR #48 remains **draft**, based on the unmerged stabilisation branch; no merge or Firebase deployment was performed. Existing Vercel automation supplies a review preview. No external user study or physical-webcam readiness claim is made.


Next reliability work requires independently reviewed, source/signer-disjoint negative training/calibration/evaluation data, more Q and physical-left examples, and consenting independent Deaf signers across real cameras, lighting, framing, speeds, hand exits, rest/waving and non-fingerspelling ASL. This remote environment does not provide those participants or physical cameras. No user-laptop control was performed.
