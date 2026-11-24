# Training datasets for ASL and what each one is good for

This is the shortlist worth knowing about, with the licence constraint that decides whether a model
trained on it can ship. Names, sizes and vocabularies say nothing about whether the licence allows
deployment: the training pipeline here requires a human-confirmed licence record before a dataset is
used, and that rule is why several listed here are evaluation-only.

## What the pipeline actually consumes

The Engine V3.1 model is trained on **86 landmark points per frame** — two 21-point hands, 13 body
points, and 32 face points — resampled to 48 steps at 15 Hz (`engine-v3/web/preprocess.mjs`,
`engine-v3/pipeline/extract.py`). It never sees pixels. So a dataset is cheap to use when it ships
landmarks, and cheap-ish when it ships video: `scripts/diagnostics/video-to-features.py` turns any
video file into exactly those rows, which is the same converter used to score public clips in
`LIVE_RECOGNITION_DIAGNOSTICS.md`.

## Word-level ASL

| dataset | size | ships | licence | fit here |
|---|---|---|---|---|
| **PopSign ASL v2.1** (Georgia Tech / DPAN) | ASL vocabulary game, Deaf signers, phone video | video + landmarks | CC BY 4.0 (commercial use allowed with attribution) | the source of the shipped checkpoint; the most licence-clean path to retrain |
| **Google ISLR** (Kaggle, 2023) | ~94,000 landmark sequences, 250 signs | **landmarks only** (543-point Holistic) | Kaggle competition terms; accept rules before use | best technical fit: map 33 pose + 42 hand points into the 86 slots, no video to download |
| **WLASL** | 2,000 glosses, ~21k clips, 100+ signers | YouTube IDs | C-UDA: academic/computational only, **no commercial use** | evaluation and research; cannot ship weights trained on it in a commercial product |
| **MS-ASL** | ~25k clips, 1,000 signs, 222 signers | YouTube IDs | Microsoft research licence | research; same commercial caveat as WLASL |
| **ASL Citizen** | ~84k clips, 2,731 signs, 52 Deaf signers, dictionary style | video | research licence | used in this repo for evaluation only |
| **FSBoard** (Google, 2023) | fingerspelling, millions of characters | video + landmarks | CC BY 4.0 | already used for 600 UNKNOWN negatives |
| **ChicagoFSWild / +** | fingerspelling in the wild | video | research licence | fingerspelling research only |

## Continuous ASL (not what this model does)

| dataset | size | ships | licence |
|---|---|---|---|
| **How2Sign** | ~80 hours, multi-view, English translations | video + OpenPose poses | research licence |
| **OpenASL** | hundreds of hours from YouTube with English translations | YouTube IDs | research licence |
| **YouTube-ASL** (Google, 2023) | ~1,000 hours, 250+ signers, English captions | video IDs + metadata | open download of metadata; video terms follow YouTube |

Isolated-sign recognition (this model) does not need these, but they are the starting point if the
project ever moves to continuous translation.

## Other sign languages

The repository already ships models for several, and `docs/language-expansion-research-2026-09-19.md`
records the licence work behind each: BSL-1K (BSL, 1,064), INCLUDE (ISL, 263; CC-BY-4.0 metadata),
HFAD/HFNE (PSL dictionary signs), Slovo (RSL, 967), BdSLW401 (Bangla, 401), SWL-LSE (LSE, 300,
SignRelay-trained), AUTSL (Turkish, 226), LSA64 (Argentinian, 64), CSL/SLR500 (agreement must be
signed by full-time staff, so nothing is bundled).

## What internet data can and cannot fix here

Measured on twelve public per-word clips from different signers and studios:

- **Recognised signs generalise.** PLEASE 3/3 correct top-1 (embedding similarity across the three
  videos: 0.86-0.90), YES 2/2 (0.71), WATER 2/2 (0.59).
- **Variant mismatch does not.** THANK-YOU and STOP failed, and their cross-video similarity was 0.24
  and 0.13 — the two videos of each word were not even the same sign as each other, let alone as
  PopSign's.
- **A bigger YouTube-derived model is not automatically better.** The WLASL-2000 Pose-TGCN checkpoint
  built from YouTube data answers PLEASE with SNOWMAN 0.87 and YES with AUDIOLOGIST 0.91 on this
  signer's own windows.
- **A public-video dictionary is feasible for some signs.** Enrolling one stranger's video and testing
  another stranger's: same word 0.59-0.90 against different words at or below 0.32. At the matcher's
  0.75 bar that covers PLEASE and YES but not WATER, so it would need a lower bar and more collision
  risk than the signer's own recordings (0.93 same-sign, 0.27 different-sign).

## Does any of this transfer to the other languages?

The dataset does not, and neither does the training path without work — but the *pattern* does. The
repository ships model-backed recognition for ASL (V3.1, 523 classes), BSL (Pose2Sign, 1,064), ISL
(INCLUDE, 263), LSE (temporal landmark, 300), RSL (Slovo, 1,000), BdSL (VideoMAE, 401) and PSL (HFAD,
776, one-shot), and signer-taught recognition for the remaining ~25 language options.

| layer | reaches other languages? |
|---|---|
| the ISLR dataset | **No.** It is ASL: 250 American signs recorded by 21 Deaf signers. Merging it into the BSL, ISL, RSL or LSE models would teach those models American signs under the wrong labels. |
| `import_islr.py` landmark conversion | **Yes, with a different label file.** Converting long-format MediaPipe rows into `[T, 86, 3]` is language-neutral; a dataset for another sign language only changes which glosses are attached. |
| `merge_cache.py` | **Yes, unchanged.** It merges shards by signer and clip; it never looks at meaning. |
| `train.py` | **Only for a V3.1-style model.** It trains the ASL Convformer on 15 Hz landmark sequences. BSL (Pose2Sign), ISL (transformer), RSL (MViTv2), BdSL (VideoMAE) and PSL (DTW) are different architectures with different input contracts, so a language that wants this trainer needs a dataset in this format first. |
| next-word predictor | **Only ASL today**, deliberately. The corpus is English gloss in ASL order, so it is offered for ASL and withheld elsewhere; `lib/next-word-corpus.ts` is where a language's gloss sequences would be added. |
| taught signs (your own vocabulary) | **Every language.** Each adapter can be taught on-device; ASL additionally matches taught signs by model embedding (0.93 same sign), while the other languages use DTW templates. |

So the honest answer: a single dataset buys accuracy for one sign language. The machinery around it —
conversion, signer-disjoint merge, reversible cache, device selection, the Kaggle runner — is reusable,
and is what would make a second language cheap to add once its own dataset exists.

The practical reading: internet data is the right tool for building a **shared** model that a stranger
can use, and a poor substitute for **your own** two minutes of teaching. If a booth needs forty words
that work today, teach them. If it needs a product that works for anyone, budget for PopSign plus a
consented in-house cohort, and expect a training run rather than a download.

## Adding a dataset to the existing model

`engine-v3/pipeline/import_islr.py` converts a Kaggle ISLR download into the trainer's cache format and
`engine-v3/pipeline/merge_cache.py` merges it into an existing cache without losing what was there (it
copies the originals to `*.base.*`, is idempotent, and has `--restore`). The verified behaviour and the
step-by-step runbook are in [islr-training-run.md](islr-training-run.md); the converter is tested
against a synthetic dataset in the published schema by `training/test_islr_import.py`.

## If you retrain

1. Confirm the licence in writing for every dataset used, and record it — the pipeline requires it.
2. Convert to landmark rows (`extract.py` for video corpora, `video-to-features.py` for one-off clips).
3. Keep signers disjoint between train and test; the sprint evidence in `docs/evaluation/` is built on
   that split and every accuracy number here depends on it.
4. Report the paired comparisons the repo already gates on (`npm run eval:log`, `docs/evaluation/`),
   not just a headline top-1.
