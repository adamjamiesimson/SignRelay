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


REQUIRED_COLUMNS = (
    "sample_id",
    "video_path",
    "gloss",
    "signer_id",
    "language",
    "source",
    "license_id",
    "split",
)


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
        missing = set(REQUIRED_COLUMNS).difference(reader.fieldnames or [])
        if missing:
            raise ValueError(f"Manifest is missing columns: {sorted(missing)}")
        samples = [Sample(**{key: (row.get(key) or "").strip() for key in REQUIRED_COLUMNS}) for row in reader]
    if not samples:
        raise ValueError("Manifest is empty")
    return samples


def audit(samples: list[Sample], manifest_dir: Path, approved_licenses: set[str]) -> dict:
    duplicate_ids = sorted(item for item, count in Counter(s.sample_id for s in samples).items() if count > 1)
    duplicate_paths = sorted(item for item, count in Counter(s.video_path for s in samples).items() if item and count > 1)
    missing_files = sorted({s.video_path for s in samples if s.video_path and not (manifest_dir / s.video_path).is_file()})
    required_metadata = ("sample_id", "video_path", "gloss", "signer_id", "language", "source", "license_id")
    missing_metadata = {
        field: sorted(s.sample_id or f"row-{index + 1}" for index, s in enumerate(samples) if not getattr(s, field))
        for field in required_metadata
    }
    missing_metadata = {field: rows for field, rows in missing_metadata.items() if rows}
    unapproved = sorted({s.license_id for s in samples if s.license_id and s.license_id not in approved_licenses})
    languages = sorted({s.language for s in samples if s.language})
    signers = {s.signer_id for s in samples if s.signer_id}
    if len(languages) != 1:
        raise ValueError(f"One model bundle must contain one language, found: {languages}")
    report = {
        "samples": len(samples),
        "language": languages[0],
        "signers": len(signers),
        "classes": len({s.gloss for s in samples if s.gloss}),
        "duplicate_sample_ids": duplicate_ids,
        "duplicate_video_paths": duplicate_paths,
        "missing_files": missing_files,
        "missing_metadata": missing_metadata,
        "unapproved_license_ids": unapproved,
        "enough_signers_for_three_way_split": len(signers) >= 3,
    }
    if duplicate_ids or duplicate_paths or missing_files or missing_metadata or unapproved or len(signers) < 3:
        raise ValueError(json.dumps(report, indent=2))
    return report


def signer_split(samples: list[Sample], seed: int = 42) -> list[Sample]:
    by_signer: dict[str, list[Sample]] = defaultdict(list)
    for sample in samples:
        by_signer[sample.signer_id].append(sample)
    signers = sorted(by_signer)
    if len(signers) < 3:
        raise ValueError("At least three signers are required for signer-independent train/validation/test splits")
    random.Random(seed).shuffle(signers)

    # Reserve at least one complete signer for validation and test. The old
    # rounded cut points could silently produce an empty test split for small
    # but otherwise valid datasets (for example, three signers).
    train_count = max(1, min(len(signers) - 2, round(len(signers) * 0.70)))
    remaining = len(signers) - train_count
    validation_count = max(1, min(remaining - 1, round(len(signers) * 0.15)))
    train_end = train_count
    validation_end = train_count + validation_count
    assignment = {
        signer: "train" if index < train_end else "validation" if index < validation_end else "test"
        for index, signer in enumerate(signers)
    }
    return [Sample(**{**asdict(sample), "split": assignment[sample.signer_id]}) for sample in samples]


def split_integrity_report(samples: list[Sample]) -> dict:
    expected_splits = ("train", "validation", "test")
    signer_splits: dict[str, set[str]] = defaultdict(set)
    for sample in samples:
        signer_splits[sample.signer_id].add(sample.split)
    signer_leakage = {
        signer: sorted(splits) for signer, splits in signer_splits.items() if len(splits) > 1
    }
    classes = sorted({sample.gloss for sample in samples})
    class_counts = {
        split: Counter(sample.gloss for sample in samples if sample.split == split)
        for split in expected_splits
    }
    return {
        "split_counts": {split: sum(sample.split == split for sample in samples) for split in expected_splits},
        "split_signers": {
            split: len({sample.signer_id for sample in samples if sample.split == split})
            for split in expected_splits
        },
        "split_class_counts": {split: dict(counts) for split, counts in class_counts.items()},
        "classes_missing_by_split": {
            split: sorted(set(classes) - set(class_counts[split])) for split in expected_splits
        },
        "signer_leakage": signer_leakage,
    }


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
    parser.add_argument(
        "--require-class-coverage",
        action="store_true",
        help="Fail if any gloss is absent from train, validation, or test after signer grouping",
    )
    args = parser.parse_args()

    samples = read_manifest(args.manifest)
    report = audit(samples, args.manifest.parent, set(args.approved_license))
    split = signer_split(samples, args.seed)
    integrity = split_integrity_report(split)
    if integrity["signer_leakage"]:
        raise ValueError(f"Signer leakage detected after splitting: {integrity['signer_leakage']}")
    if args.require_class_coverage and any(integrity["classes_missing_by_split"].values()):
        raise ValueError(json.dumps({
            "message": "Class coverage requirement failed after signer-independent splitting",
            **integrity,
        }, indent=2))
    write_manifest(split, args.output)
    report["split_integrity"] = integrity
    report["output_sha256"] = file_sha256(args.output)
    print(json.dumps(report, indent=2, default=dict))


if __name__ == "__main__":
    main()
