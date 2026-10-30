"""Confidence-gate calibration for ASL-2000 from committed evaluation records.

For a chosen condition, sweep the production (confidence, margin) gate and
report how many signs are accepted, how many of those are correct, and how
often out-of-vocabulary clips are accepted. Used to decide whether a gate change
is justified; it never edits production settings.
"""

from __future__ import annotations

import argparse
import gzip
import json
from pathlib import Path


def records(path: Path) -> list[dict]:
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("records", type=Path, nargs="+")
    parser.add_argument("--condition", required=True, action="append")
    args = parser.parse_args()
    rows = [r for path in args.records for r in records(path) if r["condition"] in args.condition]
    positives = [r for r in rows if r.get("target") is not None]
    negatives = [r for r in rows if r.get("target") is None]
    print(json.dumps({"conditions": args.condition, "positives": len(positives), "out_of_vocabulary": len(negatives),
                      "top1": round(sum(r["rank"] == 1 for r in positives) / max(1, len(positives)), 4)}))
    print("confidence | margin | accepted | correct | precision | recall | OOV accepted")
    for confidence in (0.3, 0.4, 0.5, 0.62, 0.7, 0.8, 0.9, 0.95):
        for margin in (0.0, 0.1, 0.22, 0.4, 0.6):
            if margin > confidence:
                continue
            accepted = [r for r in positives if r["confidence"] >= confidence and r["margin"] >= margin]
            correct = sum(r["rank"] == 1 for r in accepted)
            oov = sum(1 for r in negatives if r["confidence"] >= confidence and r["margin"] >= margin)
            print(f"{confidence:.2f} | {margin:.2f} | {len(accepted)} | {correct} | "
                  f"{correct / len(accepted) if accepted else float('nan'):.3f} | {correct / max(1, len(positives)):.3f} | "
                  f"{oov}/{len(negatives)}")


if __name__ == "__main__":
    main()
