"""SignRelay reproducible training pipeline scaffold.

This script validates dataset provenance and prepares signer-independent splits.
Landmark extraction and model training are explicit opt-in stages because their
dependencies and compute requirements differ between local CPU and Colab/Kaggle.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import random
from collections import Counter, defaultdict
from dataclasses import dataclass, asdict
from pathlib import Path


REQUIRED_COLUMNS = {
    "sample_id",
    "video_path",
    "gloss",
    "signer_id",
    "language",
    "source",
    "license_id",
    "split",
}


@dataclass(frozen=True)
class Sample:
    sample_id: str
    video_path: str
    gloss: str
    signer_id: str
    language: str
    source: str
    license_id: str
    split: str = ""


def read_manifest(path: Path) -> list[Sample]:
    with path.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        missing = REQUIRED_COLUMNS.difference(reader.fieldnames or [])
        if missing:
            raise ValueError(f"Manifest is missing columns: {sorted(missing)}")
        samples = [Sample(**{key: (row.get(key) or "").strip() for key in REQUIRED_COLUMNS}) for row in reader]
    if not samples:
        raise ValueError("Manifest is empty")
    return samples


def audit(samples: list[Sample], manifest_dir: Path, approved_licenses: set[str]) -> dict:
    duplicate_ids = [item for item, count in Counter(s.sample_id for s in samples).items() if count > 1]
    missing_files = [s.video_path for s in samples if not (manifest_dir / s.video_path).exists()]
    missing_signers = [s.sample_id for s in samples if not s.signer_id]
    unapproved = sorted({s.license_id for s in samples if s.license_id not in approved_licenses})
    languages = sorted({s.language for s in samples})
    if len(languages) != 1:
        raise ValueError(f"One model bundle must contain one language, found: {languages}")
    report = {
        "samples": len(samples),
        "language": languages[0],
        "signers": len({s.signer_id for s in samples}),
        "classes": len({s.gloss for s in samples}),
        "duplicate_sample_ids": duplicate_ids,
        "missing_files": missing_files,
        "missing_signer_ids": missing_signers,
        "unapproved_license_ids": unapproved,
    }
    if duplicate_ids or missing_files or missing_signers or unapproved:
        raise ValueError(json.dumps(report, indent=2))
    return report


def signer_split(samples: list[Sample], seed: int = 42) -> list[Sample]:
    by_signer: dict[str, list[Sample]] = defaultdict(list)
    for sample in samples:
        by_signer[sample.signer_id].append(sample)
    signers = sorted(by_signer)
    random.Random(seed).shuffle(signers)
    train_end = max(1, round(len(signers) * 0.7))
    validation_end = max(train_end + 1, round(len(signers) * 0.85))
    assignment = {
        signer: "train" if index < train_end else "validation" if index < validation_end else "test"
        for index, signer in enumerate(signers)
    }
    return [Sample(**{**asdict(sample), "split": assignment[sample.signer_id]}) for sample in samples]


def write_manifest(samples: list[Sample], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(REQUIRED_COLUMNS))
        writer.writeheader()
        writer.writerows(asdict(sample) for sample in samples)


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description="Audit and split a SignRelay dataset manifest")
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--approved-license", action="append", default=[], help="Verified licence identifier; repeat as needed")
    parser.add_argument("--output", type=Path, default=Path("artifacts/split-manifest.csv"))
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    samples = read_manifest(args.manifest)
    report = audit(samples, args.manifest.parent, set(args.approved_license))
    split = signer_split(samples, args.seed)
    write_manifest(split, args.output)
    report["split_counts"] = Counter(sample.split for sample in split)
    report["output_sha256"] = file_sha256(args.output)
    print(json.dumps(report, indent=2, default=dict))


if __name__ == "__main__":
    main()
