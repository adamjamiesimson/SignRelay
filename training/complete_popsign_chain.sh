#!/usr/bin/env bash
# One implementation and one bounded retry budget for every PopSign consumer.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
timeout 240 bash "$root/scripts/asl2000-eval/complete-ca-chain.sh" signdata.cc.gatech.edu "$1"
