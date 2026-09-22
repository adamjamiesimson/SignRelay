"""Audit a candidate word map; coverage does not establish linguistic correctness."""
from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path
import re

from export_ksl_onnx import sha256


def audit(path: Path, source: str) -> dict:
    with path.open(encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream)
        if set(reader.fieldnames or []) != {"word_id", "bangla", "romanized", "english"}:
            raise ValueError("Expected word_id, bangla, romanized, english columns")
        rows = list(reader)
    expected = {f"W{i:03}" for i in range(1, 402)}
    seen: set[str] = set()
    duplicate, invalid, empty = [], [], []
    for row in rows:
        code = row["word_id"]
        if code in seen:
            duplicate.append(code)
        seen.add(code)
        if code not in expected:
            invalid.append(code)
        if any(not row.get(key, "").strip() or re.fullmatch(r"W\d{3}", row[key].strip())
               for key in ("bangla", "romanized", "english")):
            empty.append(code)
    missing = sorted(expected - seen)
    return {
        "source": source, "sourceSha256": sha256(path), "rows": len(rows),
        "uniqueClassCodes": len(seen), "missingCodes": missing,
        "duplicateCodes": duplicate, "invalidCodes": invalid,
        "emptyOrPlaceholderLabels": empty,
        "complete401CodeCoverage": not (missing or duplicate or invalid or empty),
        "linguisticallyVerified": False,
        "activationApproved": False,
        "limitations": "Structural audit only. Verify source provenance, text accuracy, permissions and checkpoint class order before use.",
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("csv", type=Path)
    parser.add_argument("--source", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = audit(args.csv, args.source)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))
    raise SystemExit(0 if result["complete401CodeCoverage"] else 1)
