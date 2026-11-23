# Adding the Google ISLR dataset and retraining

The Kaggle *Isolated Sign Language Recognition* dataset (Google, 2023) is the best licence-clean fit
for this pipeline: ~94,000 landmark sequences over 250 signs, shipped as parquet rather than video, in
the same MediaPipe Holistic point layout the browser uses. It is **additive** here — the PopSign cache
and the shipped checkpoint stay exactly as they are.

Licence status: the competition data is released for use under its competition rules, which suit a
non-commercial competition project. It is not redistributable: do not commit the download, the
extracted landmarks, or a cache built from them. A model trained on it is fine to run and share for
this project; check the rules before any commercial use.

## What is verified, and what is not

Verified on this machine, with a synthetic dataset in the published schema
(`training/test_islr_import.py`, 4 tests):

- the importer writes the exact contract `train.py` reads: `pts` float16 `[sumT, 86, 3]`, `offsets`
  int64, and a sidecar with `key, sign, signer, frames, hand_frames, width, height, fps, duration`;
- a hand column that is all zeros (how the dataset says "not detected") becomes a missing hand, not a
  hand at the origin;
- splits are signer-disjoint, and a non-zero fraction always claims at least one signer;
- the merge keeps the existing rows first, is idempotent, and `--restore` puts the original cache back;
- a sign the vocabulary has never seen becomes a new class: a 3-clip synthetic run went from 523 to
  524 classes and trained (`classes 524 (+UNKNOWN)`).

Not verified, because it needs things this machine does not have: the real dataset (behind Kaggle
sign-in and rule acceptance), and a training budget. Sizes and times below are estimates to plan with,
not measurements.

## Steps

```bash
# 1. Data (needs a Kaggle account and accepting the competition rules once)
pip install kaggle
mkdir -p ~/data/islr && cd ~/data/islr
kaggle competitions download -c google-islr-2023      # name as shown on the competition page
unzip -q *.zip                                        # expect train.csv + train_landmark_files/
du -sh .                                              # several GB of parquet; keep 30-40 GB free to convert

# 2. Convert to this project's cache format (does not touch the PopSign cache)
cd <repo>
python engine-v3/pipeline/import_islr.py \
  --landmarks ~/data/islr/train_landmark_files \
  --meta ~/data/islr/train.csv \
  --out ~/data/cache --max-per-class 120

# 3. Merge into the cache the trainer reads (originals copied to {split}.base.* first)
python engine-v3/pipeline/merge_cache.py --cache ~/data/cache --add islr
python engine-v3/pipeline/merge_cache.py --cache ~/data/cache --restore   # undo, any time

# 4. Train, keeping the existing checkpoint untouched
python engine-v3/train/train.py --cache ~/data/cache --out runs/v3.2-islr \
  --epochs 60 --balance 0.5 --fs-negatives

# 5. Export and compare against the shipped checkpoint before replacing anything
python engine-v3/train/export_onnx.py --run runs/v3.2-islr --out runs/v3.2-islr/onnx
```

Then score the candidate on the same evidence the shipped model is scored on — the saved live clips in
`scripts/diagnostics/replay-live-clip.mjs`, the public per-word videos through
`scripts/diagnostics/video-to-features.py`, and the paired evaluation in `docs/evaluation/`. A model
that is better on the merged validation split but worse on the signer's own clips is not an
improvement; the booth is the gate.

## What to expect

- **New classes, not just better ones.** ISLR's 250 signs overlap the existing 523 unevenly; the rest
  arrive as new classes, so the head grows. Check the overlap after step 2 by comparing the distinct
  `sign` values in `cache/islr_train.json` with `engine-v3/vocabulary/popsign_signs.json`.
- **More signers is the point.** The shipped checkpoint was trained on PopSign tranches only. ISLR adds
  many more signers per sign, which is the difference between a model that works for the person who
  trained it and one that works for a stranger — the failure this repo has measured repeatedly.
- **`--max-per-class` matters.** Without a cap the merged cache is dominated by whichever dataset has
  more clips per sign, which reshapes the class balance more than the model improves. The importer
  caps, and `train.py --balance 0.5` counteracts the rest.
- **Licence bookkeeping.** Record the dataset, the rule acceptance date and the clip counts
  (`cache/islr_source.json` writes them) next to the run, as the training pipeline requires.
