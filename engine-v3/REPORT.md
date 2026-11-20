# SignRelay Engine V3 — results report (v3.0)

Everything below was measured in this session on the hardware described in § C. Machine-readable
evidence is in [`ledger/`](ledger/) (`experiments.jsonl`, sealed reports, parity runs). Decisions were
made before results where stated, and the commit history shows the order.

**Bottom line.** V3.0 is a trained, frozen **523-class** isolated-ASL recognizer. On the sealed PopSign test
(10 signers never seen in training) it reaches **80.8 % top-1 / 96.3 % top-5**, with all 523 classes covered.
That is below the 90 % aspiration. It rejects fingerspelling and most out-of-vocabulary signs, and the
browser reproduces the native model exactly. Two problems remain. Accuracy drops on an external webcam
cohort (54.6 %). The live camera path, at 11–13 fps in this CPU-only container, committed only 8 of 30
test signs correctly, so live use is not ready yet.

---

## A. Research and architecture

Full decision record: [RESEARCH-DECISION.md](RESEARCH-DECISION.md).

* **Winner:** same-estimator landmark **Convformer**. MediaPipe Tasks 0.10.35 hand ×2 + pose-lite landmarks →
  in-graph featurizer → 2 × (3 depthwise-conv blocks + 1 attention block), d = 192, 1.71 M params per model.
  The shipped model is an ensemble of 2 seeds. The featurizer lives inside the ONNX graph, so Python and the
  browser cannot drift.
* **Compared under controlled conditions** (identical data: tranche A, 523 classes, 9 unseen validation signers):

| Run | Params | Val top-1 | Val top-5 | Decision |
| --- | ---: | ---: | ---: | --- |
| GRU baseline (bi-GRU ×2) | 1.37 M | 58.5 % | 83.5 % | rejected |
| Convformer, with face points | 1.71 M | 62.9 % | 86.9 % | — |
| Convformer, **no face** | 1.71 M | **63.9 %** | 87.2 % | face dropped (no gain; saves 12–19 ms/frame) |
| Convformer no face + fingerspelling negatives | 1.71 M | 63.7 % | 87.2 % | kept (no accuracy cost) |
| Convformer d = 256 × 3 | 4.29 M | 62.9 % | 86.4 % | rejected (no gain, 2× slower) |

* **Data scale mattered most.** Tranche A (≈10 clips/class) gave 63.9 %. Tranche A+B (≈25 clips/class) gave
  76.2 / 76.7 % per seed and **77.6 %** as an ensemble (validation).
* **Rejected approaches**, with reasons in the decision record: RGB video transformers (no GPU; 1.65 TB of
  video), the old OpenPose Pose-TGCN, pretrained Holistic-based encoders (different estimator and licences).
* **Why the earlier WLASL2000 Pose-TGCN failed** (§ 1.1 of the decision record): it was trained on OpenPose
  and fed remapped MediaPipe points (9.9 % top-1 measured), from a weak base model, with a lossy export that
  was never video-tested, closed-set, with mismatched segmentation, and no signer-independent evaluation.

## B. Dataset

| Source | Licence | Use | Clips used | Signers | Signs |
| --- | --- | --- | ---: | ---: | ---: |
| **PopSign ASL v2.1** game split (Georgia Tech / DPAN) | **CC BY 4.0** | train / val / sealed test | 13,876 train · 2,458 val · 3,111 test | 58 · 8 · 10 (disjoint) | 562 directories |
| FSBoard daun_v3 (Google) | CC BY 4.0 | non-vocabulary motion negatives (train) and test | 600 · 300 windows | 94 · 15 | — |
| ASL Citizen (Microsoft) | MS Research licence: non-commercial research, **no redistribution** | **evaluation only**, kept local, aggregate results only | 1,204 known + 400 OOV | 11 | 300 matched glosses |

* **Accessible:** the PopSign v2.1 index lists **314,112** videos (1.65 TB), 562 sign directories and 79
  signers. All of them are reachable over HTTPS. Only a signer-diverse subset was processed (§ 5 of the
  decision record): 27,171 extraction records, **0 download/decode failures** in the PopSign tranches,
  **0 clips with no detected hands** in training data, and **0 exact duplicates across splits** (SHA-256).
* **Signer separation:** the official PopSign splits were re-verified signer-disjoint. FSBoard-train
  signers never appear in PopSign val/test, and FSBoard-test signers never appear in PopSign train/val.
* **Vocabulary:** 562 directories − 9 a-priori alias merges (DAD/DADDY, MOM/MOMMY, HELLO/HI,
  TEDDY/TEDDYBEAR, COUCH/SOFA, BUNNY/RABBIT, ROCK/STONE, CAT/KITTY, POTTY/TOILET) − 30 held-out unknown signs
  = **523 trained sign classes**. The 14 pre-registered candidate alias groups were resolved on validation
  only, and none met the merge rule (`ledger/alias-check-val.json`). Policy frozen at commit `aeb3ab8`;
  vocabulary frozen at `9fe139a`.
* **Weights redistribution:** PopSign and FSBoard are CC BY 4.0 and attribution is shipped with the model.
  ASL Citizen did not touch training.

## C. Training

* **Actually trained:** yes. CPU only: 4 vCPU, 15 GB RAM, **no GPU**. Each production seed ran 40 epochs,
  taking 4.46 h (seed 0) and 4.17 h (seed 1) wall-clock while landmark extraction shared the CPU.
* **Checkpoints** (outside git; SHA-256 in [`models/v3.0/FREEZE.json`](models/v3.0/FREEZE.json)):
  `B-main-s0/best.pt`, `B-main-s1/best.pt`, plus every comparison run's `best.pt`/`ckpt.pt` (resumable).
* **Exported:** [`models/v3.0/model.onnx`](models/v3.0/model.onnx) (13.7 MB ensemble). Verified against
  PyTorch on 399 real validation clips: max |logit error| 5.7e-6, 100 % top-1 agreement.

## D. Vocabulary

* **523 genuinely trained sign classes**, plus one UNKNOWN output. Full manifest:
  [`vocabulary/classes-v3.0.json`](vocabulary/classes-v3.0.json).
* **523 / 523 have independent sealed-test coverage** (PopSign test signers). 522 / 523 have validation
  coverage.
* The UNKNOWN output, the 30 held-out signs and fingerspelling are **not** counted among the 523.

## E. Accuracy (sealed — model frozen at `6647a26` before any test evaluation; each test run once)

**PopSign sealed test — 10 unseen signers, 2,951 known-sign clips (4 without detectable hands count as errors):**

| Metric | Value |
| --- | --- |
| Top-1 | **80.8 %** |
| Top-5 | **96.3 %** |
| Macro recall | 80.4 % |
| ECE (top-1, after temperature fitted on val) | 2.7 % |
| Per-signer top-1 | 70.5 % – 89.2 % |
| Weakest classes | WERE, LOVE, SNACK (0 %); ABOUT, ALOT, BENCH, DEER, NIGHT, SHOULD, SLED (17 %) |
| Top confusions | ABOUT→WHEN, BENCH→COUCH, DEER→MOOSE, LOVE→HUG, SHOULD→NEED, ALOT→MUCH, BATHROOM→TOILET, WERE→WAS |

**Open-set decision policies** (both fitted on validation signers + calibration-only unknown signs before the test):

| Policy | Known coverage | Accepted precision | Correct accepts | Wrong accepts | Never-seen unknown signs accepted (49 clips) | Fingerspelling accepted (300) | ASL Citizen OOV accepted (400) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| **Balanced (default)** | 66.2 % | **93.7 %** | 62.0 % | 4.2 % | 24.5 % | **0 %** | 12.3 % |
| Strict | 53.1 % | **97.4 %** | 51.7 % | 1.4 % | 14.3 % | **0 %** | 7.5 % |

Status outputs: *accepted*, *unknown* (not a supported sign), *uncertain* (best guess shown, not committed)
and *no-sign* (no usable hand evidence).

**External cohort — ASL Citizen, 11 webcam signers, 300 glosses matched one-to-one by name, evaluation only:**
54.6 % top-1, 73.3 % top-5. Balanced policy: 39 % coverage, 86.8 % accepted precision. Diagnosis:

* Hand tracking coverage is similar to PopSign (45 % vs 49 % of frames), so this is **not** a tracking failure.
* Results split into two groups: 149 glosses score ≥ 75 % recall and 75 score 0 %. Many 0 % glosses land on
  synonymous PopSign variants (HURT→OWIE, LISTEN→HEAR, MUCH→ALOT, MUST→HAVETO). Gloss/variant mismatch
  explains a large share; the rest is genuine domain shift.

**Robustness — 120 unseen test clips × 8 video conditions, full pixel pipeline:**

| Condition | Top-1 | Top-5 | Accepted precision | Clips with no hands found |
| --- | ---: | ---: | ---: | ---: |
| original | 78.3 % | 97.5 % | 93.8 % | 0 |
| brighter / over-exposed | 75.8 % | 93.3 % | 92.2 % | 2 |
| sensor noise | 77.5 % | 95.8 % | 94.9 % | 0 |
| fast signer (1.35×) | 77.5 % | 97.5 % | 92.7 % | 0 |
| slow signer (0.7×) | 80.0 % | 96.7 % | 92.4 % | 0 |
| landscape webcam framing | 76.7 % | 96.7 % | 90.0 % | 0 |
| **dim room** | 27.5 % | 39.2 % | 92.6 % | **55** |
| **camera ~1.8× farther** | 38.3 % | 45.0 % | 94.4 % | **48** |

Diagnosis: dim and distant video fail because the **hand landmarker loses the hands at a 480 px analysis
size**, not because of the classifier. Re-extracting at 960 px removed almost all no-hand clips (far
14 → 0, dark 21 → 2 of 40). The frozen model then reached 70 % (far) and 62.5 % (dark) without retraining.

## F. Browser parity (40 validation clips: native Python vs Chrome lab, identical files)

| Stage | Result |
| --- | --- |
| ONNX Runtime Web vs native ONNX on identical landmarks | max logit error < 4e-6 (identical) |
| Preprocessing JS vs Python on real clips | exact (`parity/preprocess.test.mjs`, max error < 1e-6) |
| Frame sampling (after matching ffmpeg's `round(duration × 15)`) | 34 / 39 identical counts, rest ±1 at clip end |
| Hand landmarks Chrome vs native | median abs error 0.0013 (normalised) ≈ 0.6 px |
| Top-1 agreement / final-decision agreement | 85 % / 85 % |
| Accuracy vs truth, native vs Chrome | top-1 25/34 vs **30/34**; accepted 22 (21 correct) vs 22 (21 correct); unknowns accepted 2/6 vs 2/6 |

Remaining disagreements are near-threshold decisions moved by sub-pixel decoder and downscaler
differences. The browser shows no systematic accuracy loss.

**Live camera path** (Chrome fake camera fed Y4M reels; the real `getUserMedia` → worker → segmenter path):

* Segmentation is sound. There were **0 spurious events in idle gaps**, **0 duplicate accepts**,
  intentional repeats produced separate events, and unknown/fingerspelling intervals were rejected.
* Accuracy is **frame-rate-bound**. With the same segmenter on validation reels, native 15 Hz landmarks gave
  9/12 correct and 0 wrong. At 7.5 Hz it fell to 5/12 correct (0 wrong). In this container Chrome analyses
  11–12 fps and gets 6–7/12 (0 wrong).
* Sealed test-signer reels (36 intervals, run once with the final build): see the table below.

| Sealed reels (3 × 12 intervals, test signers, final build, 12–13 fps analysed) | Count |
| --- | ---: |
| Supported-sign intervals (incl. intentional A, B, A, A repeats) | 30 |
| Correct accepted | **8** |
| Wrong accepted | 7 — TO→HAVETO ×3 (one clip repeated), DONT→NOT ×2 (one clip), NIGHTNIGHT→NIGHT, DUMP→POUR |
| Abstained (uncertain / unknown) | 15 |
| Missed (no event at all) | 0 |
| Unsupported intervals (never-seen sign or fingerspelling) | 6 — 1 false accept (→WISH) |
| Spurious events in idle gaps / duplicate accepts | **0 / 0** |
| Exact sequence match | 0 / 3 reels |

**Live camera recognition is not yet at file-mode level.** File mode reached ~85 % top-1 on the same clips
natively, but the live path committed only 8 of 30 signs correctly. Every wrong answer is a lexical
neighbour, and 5 of the 7 come from two repeated clips. The cause measured above is the analysed frame rate
(11–13 fps vs the 15 Hz design point on this CPU-only container). Real-device fps measurement is the most
important open item before human trials.

## G. Practical performance (headless Chrome 157, this 4-vCPU CPU-only container)

| Measure | Value |
| --- | --- |
| Lab startup (assets verified by SHA-256, WASM + models initialised) | 2.0 s (4.7 s under heavy CPU load) |
| Hand landmarker / pose-lite per frame | ~55 ms / ~26 ms (CPU WASM; no GPU in container) |
| Analysed camera fps | 11–12 fps (design 15 Hz) |
| Classification (ensemble ONNX, WASM, per segment) | median 31 ms, p95 69 ms |
| Download size | model 13.7 MB + hand 7.8 MB + pose 5.8 MB + WASM ≈ 23 MB |
| File mode | ~2 analysed frames/s on 6–8 MP portrait sources (seek-bound; not a live path) |

Memory was not instrumented in headless Chrome. Real-device measurements (GPU delegate, phones) are still
outstanding.

## H. Demonstration

* The lab is in [`web/`](web/) (camera, video upload, proposal/confirmed events, calibrated top-5, unknown
  abstention, diagnostics, model/commit fingerprint, measured fps, sign-testing panel, anonymous JSON export).
  Build it with `node engine-v3/web/build.mjs engine-v3/models/v3.0` and serve with `node engine-v3/web/serve.mjs`.
* **Not deployed.** The Vercel token was declined, so nothing was published. `web/dist/vercel.json` carries the
  isolation headers. To deploy as a new project (not the production one), run `vercel deploy engine-v3/web/dist`
  from a machine with your Vercel login.
* No Firebase, production Vercel or `signrelay.web.app` changes.

## I. Reproducibility

Commands: [README.md](README.md). Every tranche manifest is deterministic (`pipeline/plan.py`), extraction is
resumable, and training is resumable. Run configurations and logs are in `models/v3.0/` (`config-s*.json`,
`trainlog-s*.jsonl`), and all metrics are in `ledger/`. The sealed-test guard (`evaluate.py --sealed-test`)
writes lock files, which are committed in `ledger/sealed-v3.0/`.

## J. Remaining problems and next experiments

1. **Accuracy is below 90 %.** It was 80.8 % at roughly 25 clips per class. Data scaling was the strongest
   lever measured (63.9 % → 76–77 % on validation from about 2.5× more data). Tranche D (5.7k clips) is
   partly extracted, and tranche E (19.3k) has not been started.
2. **Linguistically close pairs** (DEER/MOOSE, LOVE/HUG, WERE/WAS, BATHROOM/TOILET, ALOT/MUCH) need either
   more data or a human ASL review of whether PopSign's prompts are distinct signs.
3. **Live frame rate.** Measure on real devices with the GPU delegate. Try a cheaper pose cadence; this changes
   the input and must be re-validated.
4. **Low light / distance.** Retrain on landmarks extracted at ≥ 720 px (v3.1) and re-run the robustness suite.
5. **Webcam domain shift** (ASL Citizen 54.6 %). Re-evaluate after variant-aware gloss mapping, then consider a
   licence-compatible webcam training source.
6. **Unknown-sign rejection** is moderate: 14–25 % of never-seen PopSign signs are accepted. The estimate rests
   on only 49 clips, and similar-looking unknown signs map to look-alike classes.
7. **Ordinary everyday non-sign motion** has not been measured. Only fingerspelling and idle gaps were tested.
8. **Before human trials:** real-device fps, a consented webcam cohort with fluent signers, and a fluent ASL
   review of the vocabulary prompts.

## K. GitHub

* Branch `claude/friendly-thompson-qjcse8`, based on `main`. PR #62 and #63 are untouched, and nothing was
  merged or deployed.
* Key commits: `aeb3ab8` (policy frozen), `9fe139a` (vocabulary frozen), `6647a26` (model frozen before the
  sealed test), `89820b3` (sealed reports), followed by parity/robustness commits.
* The draft PR link is in the PR description of this branch.

---
Attribution: PopSign ASL v2.1 — Thad Starner et al., Georgia Institute of Technology & DPAN, CC BY 4.0.
FSBoard — Google, CC BY 4.0. MediaPipe — Google, Apache-2.0. ASL Citizen — Microsoft Research (evaluation only).
