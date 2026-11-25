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

Verified on this machine **with the real files as well as synthetic ones**: 66 downloaded clips
imported to the contract (55 clips, 1,886 frames, 86 points, 66% of point-slots finite, every clip has
hand frames), and `--check` correctly identified the real long-format layout that the importer had
wrong. The rest of the verification below uses a synthetic dataset in the published schema
(`training/test_islr_import.py`, 4 tests):

- the importer writes the exact contract `train.py` reads: `pts` float16 `[sumT, 86, 3]`, `offsets`
  int64, and a sidecar with `key, sign, signer, frames, hand_frames, width, height, fps, duration`;
- a hand column that is all zeros (how the dataset says "not detected") becomes a missing hand, not a
  hand at the origin;
- splits are signer-disjoint, and a non-zero fraction always claims at least one signer;
- the merge keeps the existing rows first, is idempotent, and `--restore` puts the original cache back;
- a sign the vocabulary has never seen becomes a new class: a 3-clip synthetic run went from 523 to
  524 classes and trained (`classes 524 (+UNKNOWN)`).

Also verified on synthetic data: `--init` seeds an empty cache from an import, and
`train.py --vocabulary` keeps the class list to signs that actually have clips (4 classes instead of
523 phantom PopSign ones) when training on one dataset alone.

The competition slug is `asl-signs`; downloading it requires accepting the rules on the competition
page once, which only the account holder can do.

Not verified, because it needs things this machine does not have: the real dataset (behind Kaggle
sign-in and rule acceptance), and a training budget. Sizes and times below are estimates to plan with,
not measurements.

## Run it in a Kaggle notebook (recommended — no download)

From a laptop the competition data is the bottleneck: the bundle is ~40 GB and the API served it at a
measured ~37-166 KB/s here, so even a thin subset costs hours. Inside a Kaggle notebook the same files
are already mounted read-only, so the work needs no download and can use the free GPU:

```python
# Cell 1 — the repository and the two libraries the trainer needs
!git clone https://github.com/friendlyfoe241-cyber/SignRelay.git
!pip install -q pyarrow onnx onnxruntime onnxscript

# Cell 2 — attach the competition: Add data -> Competitions -> Google - Isolated Sign Language Recognition
!ls /kaggle/input/asl-signs

# Cell 3 — convert, merge and train (30 epochs on the free GPU)
!python SignRelay/engine-v3/pipeline/kaggle_islr_run.py \
  --out-root /kaggle/working/islr --per-class 40 --epochs 30 --balance 0.5 --device auto
```

`kaggle_islr_run.py` runs the same four scripts as the laptop path (`import_islr.py`, `merge_cache.py`,
`train.py`, and optionally `export_onnx.py`) and prints the best epoch's top-1 and top-5. Its output
directory holds the merged `cache/` (a few hundred MB, downloadable and reusable on a laptop) and
`run/` with `best.pt`, `classes.json` and `log.jsonl`. Add `--export` to also produce ONNX.

`train.py` now selects a device automatically — CUDA on a GPU box, MPS on Apple silicon, CPU otherwise —
and always saves checkpoints on the CPU, so a run started in a notebook can be resumed on a laptop.

## One command (from a laptop, after downloading)

```bash
KAGGLE_USER=... KAGGLE_KEY=... ./engine-v3/pipeline/run_islr.sh ~/data
```

It downloads and unpacks the competition files, checks the layout of the first clip before doing
anything expensive, converts with a per-class cap, merges reversibly, and trains a candidate — then
reminds you that the candidate is not shipped until it beats the current model on the signer's own
clips. Each step is skipped when its output already exists.

## What the competition files actually look like

The published clips are **long format**, not one row per frame: `frame, row_id, type, landmark_index,
x, y, z`, where `type` is `face`, `pose`, `left_hand` or `right_hand`. 543 rows per frame, and points
that were not detected arrive as **null** triples rather than being omitted. The importer pivots this
into the project's `[T, 86, 3]`; a null triple stays missing instead of becoming a coordinate at the
origin, and `--check` reports the layout before an import runs. This was discovered from the real
files — the importer originally assumed wide columns and would have failed on every clip.

## Getting the data without the 40 GB bundle

`download-all` is ~40 GB. `engine-v3/pipeline/fetch_islr_subset.py` reads the archive's central
directory over HTTP range requests and fetches only the clips asked for, so a few signers' folders can
be pulled on a laptop:

```bash
python engine-v3/pipeline/fetch_islr_subset.py \
  --signers 49445 61333 36257 --csv ~/data/islr/train.csv --per-class 3 \
  --out ~/data/islr --workers 8
```

Notes from doing it for real:

- the archive is a ZIP64 file; the fetcher parses the 64-bit central directory, so it does not read the
  other 39 GB;
- the API redirects to a pre-signed URL that rejects a forwarded `Authorization` header, and its edge
  answers the default Python user agent with 404 — both are handled, and neither is guessable, so they
  are worth knowing before writing a client;
- range reads reset under parallel load, so they retry with backoff;
- throughput here was ~166 KB/s aggregate regardless of parallelism, i.e. **account- or
  edge-throttled, not per-connection**. Budget by bandwidth, not by clip count: 250 clips/signer is
  roughly 45 minutes at that rate, so a realistic 3-signer × 250-sign × 3-clip set is about three hours.
  On a faster connection the same fetch is minutes.
- training data has only 21 signers, ~4,800 clips each, and every signer covers all 250 signs, so
  signer-disjoint splits are coarse: three signers is one train, one validation, one test.

## Steps, if you would rather run them one at a time

```bash
# 1. Data (needs a Kaggle account and accepting the competition rules once)
pip install kaggle
mkdir -p ~/data/islr && cd ~/data/islr
kaggle competitions download -c asl-signs              # "Google - Isolated Sign Language Recognition"
unzip -q *.zip                                        # expect train.csv + train_landmark_files/
du -sh .                                              # several GB of parquet; keep 30-40 GB free to convert

# 2. Convert to this project's cache format (does not touch the PopSign cache)
cd <repo>
python engine-v3/pipeline/import_islr.py \
  --landmarks ~/data/islr/train_landmark_files \
  --meta ~/data/islr/train.csv \
  --out ~/data/cache --max-per-class 120

# 3. Merge into the cache the trainer reads (originals copied to {split}.base.* first).
#    --init seeds a cache when there is no PopSign cache yet, so the dataset can be trained alone.
python engine-v3/pipeline/merge_cache.py --cache ~/data/cache --add islr --init
python engine-v3/pipeline/merge_cache.py --cache ~/data/cache --restore   # undo, any time

# 4. Train, keeping the existing checkpoint untouched
python engine-v3/train/train.py --cache ~/data/cache --out runs/v3.2-islr \
  --epochs 60 --balance 0.5 --fs-negatives \
  --vocabulary engine-v3/vocabulary/popsign_signs.json   # drop this to train on the dataset alone

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
