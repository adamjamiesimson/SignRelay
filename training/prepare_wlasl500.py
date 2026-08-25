"""Prepare the official WLASL-500 subset for a reproducible SignRelay run.

The WLASL metadata is ordered by gloss frequency, so its first 500 entries are
the published WLASL500 vocabulary. This script never downloads videos or
changes their labels: it only checks lawful, already-obtained clips and writes
the manifest consumed by the rest of the training pipeline.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
from collections import Counter, defaultdict
from pathlib import Path


FIELDS = ["sample_id", "video_path", "gloss", "signer_id", "language", "source", "license_id", "split"]
SPLITS = {"train": "train", "val": "validation", "validation": "validation", "test": "test"}


def main() -> None:
    parser = argparse.ArgumentParser(description="Build a verified manifest for the official WLASL500 subset")
    parser.add_argument("metadata", type=Path, help="Official WLASL_v0.3.json metadata")
    parser.add_argument("video_root", type=Path, help="Directory containing the pre-processed <video_id>.mp4 clips")
    parser.add_argument("--output", type=Path, default=Path("artifacts/wlasl500/manifest.csv"))
    parser.add_argument("--limit", type=int, default=500, help="Must remain 500 for the published WLASL500 subset")
    parser.add_argument("--license-id", default="WLASL-C-UDA-1.0")
    args = parser.parse_args()

    if args.limit != 500:
        raise ValueError("This preparer is deliberately fixed to the published 500-gloss WLASL500 subset")
    entries = json.loads(args.metadata.read_text(encoding="utf-8"))
    if not isinstance(entries, list) or len(entries) < args.limit:
        raise ValueError(f"Expected at least {args.limit} WLASL gloss entries")

    output_dir = args.output.parent.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    rows: list[dict[str, str]] = []
    vocabulary: list[str] = []
    missing: list[str] = []
    malformed: list[str] = []

    for class_index, entry in enumerate(entries[:args.limit]):
        gloss = str(entry.get("gloss", "")).strip()
        instances = entry.get("instances")
        if not gloss or not isinstance(instances, list):
            malformed.append(f"class {class_index}")
            continue
        vocabulary.append(gloss)
        for instance in instances:
            video_id = str(instance.get("video_id", "")).strip()
            signer_id = str(instance.get("signer_id", "")).strip()
            split = SPLITS.get(str(instance.get("split", "")).strip().lower())
            if not video_id or not signer_id or split is None:
                malformed.append(f"{gloss}:{video_id or 'missing-video-id'}")
                continue
            video = args.video_root / f"{video_id}.mp4"
            if not video.is_file():
                missing.append(video.name)
                continue
            rows.append({
                "sample_id": video_id,
                "video_path": os.path.relpath(video.resolve(), output_dir),
                "gloss": gloss,
                "signer_id": signer_id,
                "language": "ASL",
                "source": "WLASL-v0.3",
                "license_id": args.license_id,
                "split": split,
            })

    if malformed:
        raise ValueError(f"Invalid official metadata entries ({len(malformed)}): {', '.join(malformed[:8])}")
    if missing:
        raise FileNotFoundError(
            f"Missing {len(missing)} of the requested WLASL500 clips. Do not train a partial model. "
            f"Examples: {', '.join(missing[:10])}"
        )
    if len(vocabulary) != 500 or len(set(vocabulary)) != 500:
        raise ValueError("The official WLASL500 vocabulary must contain exactly 500 distinct glosses")

    counts = Counter(row["split"] for row in rows)
    per_gloss = Counter(row["gloss"] for row in rows)
    incomplete = [gloss for gloss in vocabulary if not per_gloss[gloss]]
    if incomplete or not all(counts[split] for split in ("train", "validation", "test")):
        raise ValueError("Training requires clips and all three official splits for every published WLASL500 run")

    with args.output.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(rows)

    signers_by_split: dict[str, set[str]] = defaultdict(set)
    for row in rows:
        signers_by_split[row["split"]].add(row["signer_id"])
    overlap = {
        f"{left}_{right}": sorted(signers_by_split[left].intersection(signers_by_split[right]))
        for left, right in (("train", "validation"), ("train", "test"), ("validation", "test"))
    }
    report = {
        "dataset": "WLASL-v0.3",
        "subset": "WLASL500",
        "classes": 500,
        "samples": len(rows),
        "split_counts": dict(counts),
        "signers_by_split": {split: len(signers) for split, signers in signers_by_split.items()},
        "signer_overlap": overlap,
        "signer_independent": not any(overlap.values()),
        "licence": args.license_id,
        "warning": "A separate, explicitly consented NO_SIGN dataset is still required before open-set training.",
    }
    args.output.with_suffix(".vocabulary.json").write_text(json.dumps(vocabulary, indent=2), encoding="utf-8")
    args.output.with_suffix(".report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
