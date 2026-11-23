#!/bin/bash
PY=/home/user/data/venv/bin/python
cd /home/user/data
# let the running D-tranche extraction finish first
while pgrep -f "plan-D-train-r0-s25-59" >/dev/null; do sleep 20; done
run() { echo "=== $1 @${2}px pass $3 $(date -u +%FT%TZ)"; SIGNRELAY_LONG_SIDE=$2 nice -n 10 $PY /home/user/SignRelay/engine-v3/pipeline/extract.py popsign/plan-$1.json /home/user/data/lm --workers 3 2>&1 | grep --line-buffered -E "planned|progress|Traceback|unrecorded|worker died"; }
run D-train-r0-s25-59 720 2
run F-test-r1 480 1; run F-test-r1 480 2
run H2-aslc-val 480 1; run H2-aslc-val 480 2
run E-train-r1-s0-59 720 1; run E-train-r1-s0-59 720 2
echo "=== ALL DONE $(date -u +%FT%TZ)"
