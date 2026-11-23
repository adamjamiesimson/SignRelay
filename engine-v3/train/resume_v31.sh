#!/bin/bash
# Idempotent: (re)start V3.1 training runs and holdout-2 extraction if they are not running.
cd /home/user/SignRelay/engine-v3/train
for spec in "s0:0" "bal:0.5"; do
  n=${spec%%:*}; b=${spec##*:}
  if ! pgrep -f "runs/v31-$n " >/dev/null && ! grep -q "done best" /home/user/data/runs/v31-$n.log 2>/dev/null; then
    nohup setsid /home/user/data/venv/bin/python train.py --cache /home/user/data/cache3 --out /home/user/data/runs/v31-$n \
      --kind convformer --epochs 55 --threads 2 --no-face --fs-negatives --seed 0 --balance $b >> /home/user/data/runs/v31-$n.log 2>&1 < /dev/null &
    echo "started v31-$n"
  fi
done
cd /home/user/data
if ! pgrep -f run_extract_v31b.sh >/dev/null && ! grep -q "ALL DONE" extract_v31b.log; then
  nohup setsid ./run_extract_v31b.sh >> extract_v31b.log 2>&1 < /dev/null & echo "started extraction"
fi
