# SignRelay Engine V3 — Research and decision record

Status: decision record, written **before** any V3 model result existed (commit `aeb3ab8` froze the
vocabulary policy; this file was drafted in the same session before the first training run). Results
live in [`REPORT.md`](REPORT.md) and the experiment ledger. Nothing here is a performance claim.

## 1. Sources, papers and working implementations

| Work | What it shows | Relevance |
| --- | --- | --- |
| PopSign ASL v1.0 (Starner et al., NeurIPS 2023 D&B) [paper](https://proceedings.neurips.cc/paper_files/paper/2023/hash/00dada608b8db212ea7d9d92b24c68de-Abstract-Datasets_and_Benchmarks.html) | 250 signs, phone selfie video, signer-disjoint 31/8/8 split; 2-layer LSTM on MediaPipe landmarks: **84.2 % test top-1** | Closest published evidence for landmark recognition on this capture style |
| Google ISLR Kaggle competition (`asl-signs`, 2023) — 1st place, Hoyeol Sohn [write-up](https://www.kaggle.com/competitions/asl-signs/writeups/hoyeol-sohn-1st-place-solution-1dcnn-combined-with), [code](https://github.com/hoyso48/Google---Isolated-Sign-Language-Recognition-1st-place-solution) | 250 PopSign signs, MediaPipe Holistic landmarks; 1D depthwise-conv + Transformer trained from scratch; ~0.80 participant-split CV, 0.81 LB with a 4-seed ensemble; heavy augmentation, late dropout, AWP | Architecture template that won under a strict mobile/TFLite budget |
| Google ISLR 2nd place [code](https://github.com/ffs333/2nd_place_GISLR) | Hand-crafted distance/angle features + transformer | Confirms landmark features + lips help |
| ASL Citizen (Desai et al., 2023) [paper](https://arxiv.org/abs/2304.05934) | 2,731 signs, 52 signers, webcam; I3D 63.1 %, ST-GCN 59.5 % top-1 (signer-independent) | Large-vocabulary, webcam-domain reference; research-only licence |
| WLASL (Li et al., WACV 2020) [paper](https://arxiv.org/abs/1910.11006) | 2,000 signs; Pose-TGCN on OpenPose was the weak baseline; best recent WLASL2000 claims ~61–64 % (NLA-SLR, Uni-Sign, RGB+pose) | Explains why the previous 2,000-class integration could not work (§ 1.1) |
| SignBERT+ [paper](https://arxiv.org/abs/2305.04868), SignCLIP [paper](https://arxiv.org/abs/2407.01264) | Self-supervised / contrastive pre-training on hand poses; SignCLIP fine-tuned reaches ~0.84 R@1 on PopSign, ~0.60 on ASL Citizen | Pre-training helps most when labelled data are scarce; SignCLIP's pre-training data (Spreadthesign) carry their own licence |
| Sem-Lex (Kezar et al., 2023) [paper](https://arxiv.org/abs/2310.00196) | 84k videos; phonological auxiliary targets add ~2 % ISR | Terms not cleared; future auxiliary-loss idea |
| OOD detection: MSP (Hendrycks & Gimpel 2017), energy score (Liu et al. 2020), k-NN feature distance (Sun et al. 2022); calibration: temperature scaling (Guo et al. 2017) | Standard, cheap post-hoc open-set scores | Candidate rejection rules, compared on held-out unknown signs |
| MediaPipe Tasks (Hand/Pose/Face Landmarker), `@mediapipe/tasks-vision` 0.10.35 and Python `mediapipe` 0.10.35 | Identical task bundles run natively and in WASM | Lets training landmarks and browser landmarks come from the **same** estimator |
| ONNX Runtime Web (WASM SIMD, multithread) | Runs small conv/transformer graphs in a few ms on CPU | Browser runtime for the classifier |

### 1.1 Why the earlier WLASL2000 Pose-TGCN integration failed (audit of `public/models/asl2000-tgcn`, rebirth report)

1. **Estimator mismatch (dominant).** The checkpoint was trained on OpenPose 2-D keypoints; the app
   mapped MediaPipe Pose/Hands into the 55-node OpenPose layout. Joint definitions, hand-root
   conventions, confidence semantics and normalisation all differ. Measured: **9.9 % top-1** on
   MediaPipe inputs.
2. **Weak base model.** Pose-TGCN is WLASL's weakest published baseline even in-domain (~20 % top-1 on
   WLASL2000 in the WLASL paper); no amount of adapter work could have reached usable accuracy.
3. **Lossy export never validated on video.** The quantised browser export was verified only on 12
   random inputs (max logit error 0.24) — never on real clips through the full pipeline.
4. **Closed-set classifier, no unknown class.** A 2,000-way softmax plus a 0.62 confidence gate is not
   an open-set model; any hand motion produced a word.
5. **Segmentation mismatch.** It was trained on 50-sample isolated windows but fed motion-gated live
   segments.
6. **No signer-independent evaluation** and licence (C-UDA, non-commercial) never cleared.

V3 rule derived from this: *train on exactly the landmarks the browser will produce, put all feature
normalisation inside the exported graph, measure on unseen signers through the full video pipeline,
and treat "unknown" as a first-class outcome.*

### 1.2 Engine V2 audit (PR #62 / #63)

V2 trained on **122 clips from 31 signers** for 5 classes (+OTHER). Its weakness is data, not
plumbing: the camera worker, timestamped capture, fingerprinted assets, browser smoke tests and
replay tooling are sound. V3 reuses those *patterns* (local `tasks-vision` WASM, pinned task bundles,
worker isolation, loopback test server, Chrome replay) but not the 5-class model or rule engine.

## 2. Datasets — real access and licensing (checked in this session)

| Dataset | Actually reachable here | Scale verified | Licence | Decision |
| --- | --- | --- | --- | --- |
| **PopSign ASL v2.1** (`signdata.cc.gatech.edu/data/popsign_v2_1/game`) | Yes, per-file HTTPS | Indexed **314,112** mp4s, **562** sign directories, **79** signers; official splits train 249,226 / val 27,204 / test 37,682 with **0 signer overlap** (verified) | **CC BY 4.0** — permits training and redistributing derived weights with attribution | **Primary training + sealed test** |
| ASL Citizen (Microsoft) | Yes (45.9 GB zip, byte ranges; only needed members read) | 83,399 videos, 2,731 glosses, 52 signers; test split 32,941 / 11 signers | Microsoft Research licence: non-commercial, non-revenue research; **no redistribution of data or modifications** | **Evaluation-only external cohort**, kept local; never trained on; aggregates only |
| WLASL | Annotations only; YouTube sources decay | — | C-UDA, non-commercial | Not used (estimator + licence + link rot) |
| MS-ASL | YouTube links | — | C-UDA | Not used |
| Sem-Lex | Not reached | — | Terms unclear | Not used |
| Kaggle `asl-signs` landmarks | Host blocked in this environment | 94k sequences / 250 signs | Competition data licence | Not used; also a different (Holistic) estimator |
| FSBoard (`signdata`, fingerspelling) | Reachable | — | per publisher | Candidate source of non-vocabulary hand motion |

PopSign v2.1 is the only corpus found that combines ≥ 500 classes, many real Deaf signers, official
signer-disjoint splits and a licence that permits publishing weights. Its 562 directories are CDI
vocabulary items; several are English aliases of one ASL sign and are merged (§ 6).

## 3. Strong model candidates

| Candidate | Evidence | Cost here | Verdict |
| --- | --- | --- | --- |
| RGB video transformers / I3D / VideoMAE fine-tuning | Best on WLASL/ASL Citizen (60–64 % at 2k classes) | Needs GPU and the raw 1.65 TB of video; browser cost prohibitive | Rejected for this hardware |
| Pose-TGCN / ST-GCN on OpenPose | Weak; estimator mismatch | — | Rejected (§ 1.1) |
| **Landmark 1D-conv + Transformer (Kaggle-winning family)** | 0.80–0.81 on 250 PopSign signs, signer-split | ~1.7 M params; CPU-trainable; ONNX-exportable; ms-scale browser inference | **Primary candidate** |
| Bidirectional GRU/LSTM on landmarks | PopSign paper 84.2 % (250 signs, full data) | Cheap | **Controlled baseline** |
| Pretrained landmark encoders (SignCLIP, SignBERT+) | Help with few labels | Different estimator (Holistic) and pre-training-data licences | Deferred |

## 4. Hardware, compute and storage (measured)

* 4 vCPU, 15 GB RAM, **no GPU**, ~54 GB free disk, no paid compute.
* Download from the PopSign host: 8–15 MB/s per stream.
* Native extraction (decode → 15 Hz, long side 480 px → Hand + Pose-lite + Face Landmarker, VIDEO mode):
  **~3.7 s CPU per clip**, ~3,000 clips/hour on 4 workers. Decoding the 6–8 MP sources is ~40 % of it.
* Training a 1.7 M-parameter model: ~70 clips/s on 2 threads.

## 5. Feasibility of a 500+ class engine

Processing all 314k videos would take ~4 CPU-days, so V3 samples **by signer** (one clip per signer
per sign per round), which maximises signer diversity per CPU-hour. Planned tranches: ~19.6k training
clips (round 0, all 58 training signers that recorded each sign), +19.3k (round 1), ~2.5k validation
clips (9 signers), ~6k sealed test clips (11 signers, rounds 0–1). Published evidence (80–84 % at 250
classes with ~100× more clips per class) suggests **~65–80 % top-1 at ~520 classes** is realistic with
this budget; 90 % is unlikely without more data per class and should not be assumed.

## 6. Selected architecture

**Same-estimator landmark Convformer**: MediaPipe Tasks 0.10.35 landmarks (2 × 21 hand, 13 pose,
31 face points; aspect-corrected; 15 Hz) → sign-span trim + uniform resampling to ≤ 48 frames →
*in-graph* featuriser (shoulder-normalised positions, wrist-relative hand shape, velocities, presence
flags; 412 dims) → 2 × [3 depthwise-conv blocks + 1 self-attention block], d = 192 → masked mean
pooling → 523 sign logits + 1 UNKNOWN logit, plus an L2-normalised embedding for distance-based
rejection. Rationale: strongest published evidence for this capture style, trainable on CPU, tiny
browser cost, and the feature code exists once (in the ONNX graph) so Python and Chrome cannot drift.

## 7. Dataset strategy

* PopSign v2.1 official splits; signer IDs from the published 4-hex participant prefix; split
  membership re-verified signer-disjoint.
* Deterministic signer-round-robin sampling (`pipeline/plan.py`); manifests carry URL, signer, SHA-256.
* Exact duplicates removed by SHA-256 across *all* splits; every exclusion logged with a reason.
* **Vocabulary policy frozen before training** (`vocabulary/policy.json`): 9 a-priori alias merges
  (DAD/DADDY, MOM/MOMMY, HELLO/HI, …); 14 candidate alias groups resolved **only on validation
  confusions**; 30 signs held out as unknowns, split 10 / 10 / 10 into *train-as-UNKNOWN*,
  *calibration-only* and *test-only-never-seen*.
* Training clips may use a faster decode (deblocking skipped); validation/test use full decoding.

## 8. Evaluation methodology (fixed before model selection)

* Model selection, alias resolution and the rejection policy use **validation signers only**.
* The PopSign **test signers** stay sealed until the model and decision policy are frozen; one run.
* Clips without any detected hand are **not** removed: they count as abstentions ("no signing
  evidence") in every denominator.
* Metrics: top-1, top-5, macro recall, per-class precision/recall, confusion matrix, weakest classes,
  per-signer accuracy, ECE (after temperature scaling fitted on validation), coverage / accepted
  precision / abstention, false acceptance on never-seen unknown signs, latency/throughput.
* External cohort: ASL Citizen test signers on glosses that map one-to-one to the vocabulary, plus
  out-of-vocabulary ASL Citizen glosses as unknown signs (evaluation only).
* Browser parity: identical clips through (1) native Python, (2) ONNX Runtime, (3) Chrome video-file
  inference, (4) Chrome camera-style replay; compare landmark counts, features, logits and decisions.

## 9. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Compute too small for full corpus | Signer-diverse sampling; resumable extraction; train while extracting |
| Phone-portrait training vs. webcam-landscape use | Aspect-corrected coordinates, shoulder normalisation, affine augmentation; ASL Citizen webcam cohort measures the shift |
| Alias glosses inflate the class count | A-priori merges + validation-only confusion review; class count reported after merging |
| Unknown signs accepted | Explicit UNKNOWN class + post-hoc score; tuned on calibration-only signs, tested on never-seen signs |
| Ordinary non-sign movement | No licensed corpus available here; measured with available proxies and listed as a remaining gate |
| Python/browser drift (the V2/TGCN failure mode) | Featuriser inside ONNX; same task bundles; 4-stage parity test |
| Licence | Only CC BY 4.0 data enter weights; ASL Citizen never leaves local evaluation |

## 10. Engineering plan

1. Index PopSign v2.1, freeze vocabulary policy, extract landmarks by tranche (running).
2. Build caches; train Convformer and GRU baselines with the same data/augmentation; ablate face points.
3. Resolve alias candidates on validation; freeze; fit temperature and rejection policy on validation +
   calibration unknowns.
4. Export ONNX; verify ONNX vs PyTorch; implement browser preprocessing mirror; parity tests in Chrome.
5. Run the sealed PopSign test and the ASL Citizen external cohort once.
6. Ship the experimental lab as a static site (separate project; no production changes), report.
