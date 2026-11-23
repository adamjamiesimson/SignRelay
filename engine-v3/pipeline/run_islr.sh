#!/usr/bin/env bash
# Add the Google ISLR landmarks to the training cache and train a candidate, without touching the
# shipped checkpoint or the existing PopSign rows. See docs/islr-training-run.md.
#
#   KAGGLE_USER=... KAGGLE_KEY=... ./engine-v3/pipeline/run_islr.sh ~/data
#
# Every step is skippable by pointing at what already exists, and the merge is reversible.
set -euo pipefail

DATA=${1:-$HOME/data/islr}
CACHE=${CACHE:-$DATA/cache}
RUN=${RUN:-runs/v3.2-islr}
COMPETITION=${COMPETITION:-google-islr-2023}
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../.." && pwd)

mkdir -p "$DATA"

echo "== 1/5 dataset =="
if [ ! -f "$DATA/train.csv" ]; then
  command -v kaggle >/dev/null || { echo "install the kaggle CLI and put your API token at ~/.kaggle/kaggle.json"; exit 1; }
  echo "downloading $COMPETITION (accept the competition rules on the Kaggle website first)"
  (cd "$DATA" && kaggle competitions download -c "$COMPETITION")
  (cd "$DATA" && for zip in *.zip; do unzip -q -n "$zip"; done)
else
  echo "already unpacked in $DATA"
fi

LANDMARKS=${LANDMARKS:-$DATA/train_landmark_files}
[ -d "$LANDMARKS" ] || { echo "no $LANDMARKS — check what the zip extracted"; exit 1; }

echo "== 2/5 layout check =="
python3 "$HERE/import_islr.py" --landmarks "$LANDMARKS" --meta "$DATA/train.csv" --out "$CACHE" --check

echo "== 3/5 convert =="
python3 "$HERE/import_islr.py" --landmarks "$LANDMARKS" --meta "$DATA/train.csv" --out "$CACHE" \
  --max-per-class "${MAX_PER_CLASS:-120}"

echo "== 4/5 merge (originals kept in *.base.*, undo with merge_cache.py --restore) =="
python3 "$HERE/merge_cache.py" --cache "$CACHE" --add islr

echo "== 5/5 train a candidate =="
cd "$REPO"
python3 engine-v3/train/train.py --cache "$CACHE" --out "$RUN" --epochs "${EPOCHS:-60}" \
  --balance 0.5 --fs-negatives

cat <<DONE

Candidate trained in $RUN. It is not shipped: score it against the current model first.
  python engine-v3/train/export_onnx.py --run $RUN --out $RUN/onnx
  node scripts/diagnostics/replay-live-clip.mjs <saved clip.json> --label PLEASE
A model that wins on the merged validation split but loses on the signer's own clips is not an
improvement.
DONE
