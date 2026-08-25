"""Audit public metadata for SignRelay's proposed 100-word ISL subset.

This uses only the dataset card and video-path metadata. It never downloads a
video, creates landmarks, or declares a model trained. INCLUDE metadata has no
signer identifier, so the result cannot enter the training pipeline yet.
"""

from __future__ import annotations

import argparse
import csv
import json
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import quote
from urllib.request import urlopen


DATASET = "ai4bharat/INCLUDE"
REQUIRED_LICENSE = "cc-by-4.0"
SPLIT_SIZES = {"train": 3816, "val": 425, "test": 1009}


def get_json(url: str) -> dict:
    with urlopen(url, timeout=30) as response:
        return json.load(response)


def fetch_rows() -> list[dict]:
    rows: list[dict] = []
    dataset = quote(DATASET, safe="")
    jobs = [
        (split, offset)
        for split, size in SPLIT_SIZES.items()
        for offset in range(0, size, 100)
    ]

    def fetch_page(job: tuple[str, int]) -> tuple[str, dict]:
        split, offset = job
        payload = get_json(
            "https://datasets-server.huggingface.co/rows?dataset="
            + dataset
            + "&config=default&split="
            + split
            + "&offset="
            + str(offset)
            + "&length=100"
        )
        return split, payload

    with ThreadPoolExecutor(max_workers=6) as pool:
        for split, payload in pool.map(fetch_page, jobs):
            rows.extend({"source_split": split, **item["row"]} for item in payload["rows"])
    return rows


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--vocabulary",
        type=Path,
        default=Path("training/manifests/isl100-include-vocabulary.json"),
    )
    parser.add_argument(
        "--report",
        type=Path,
        default=Path("artifacts/isl100-include-metadata-audit.json"),
    )
    parser.add_argument(
        "--candidate-csv",
        type=Path,
        help="Optional selected public paths; it has no signer ID and is not train-ready.",
    )
    args = parser.parse_args()

    vocabulary = json.loads(args.vocabulary.read_text(encoding="utf-8"))
    if vocabulary.get("status") != "curated-not-trained" or len(vocabulary.get("classes", [])) != 100:
        raise ValueError("Expected the curated, not-trained 100-class INCLUDE manifest")

    card = get_json("https://huggingface.co/api/datasets/" + DATASET)
    licenses = {
        tag.split(":", 1)[1].lower()
        for tag in card.get("tags", [])
        if tag.startswith("license:")
    }
    if REQUIRED_LICENSE not in licenses:
        raise ValueError("Expected " + REQUIRED_LICENSE + ", found " + repr(sorted(licenses)))

    selected = {item["label"] for item in vocabulary["classes"]}
    rows = [row for row in fetch_rows() if row["label"] in selected]
    split_counts: dict[str, Counter] = {split: Counter() for split in SPLIT_SIZES}
    for row in rows:
        split_counts[row["source_split"]][row["label"]] += 1
    incomplete = {
        label: {split: split_counts[split][label] for split in SPLIT_SIZES}
        for label in selected
        if any(split_counts[split][label] == 0 for split in SPLIT_SIZES)
    }
    if incomplete:
        raise ValueError("Selected labels missing a source split: " + json.dumps(incomplete, indent=2))

    report = {
        "dataset": DATASET,
        "license": REQUIRED_LICENSE,
        "manifest_status": vocabulary["status"],
        "selected_classes": len(selected),
        "selected_paths": len(rows),
        "source_split_counts": {split: sum(counts.values()) for split, counts in split_counts.items()},
        "signer_ids_available": False,
        "training_ready": False,
        "reason": "Public INCLUDE metadata has no signer IDs; a signer-aware evaluation plan is required before training.",
    }
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")

    if args.candidate_csv:
        args.candidate_csv.parent.mkdir(parents=True, exist_ok=True)
        with args.candidate_csv.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(
                handle,
                fieldnames=[
                    "sample_id",
                    "video_path",
                    "gloss",
                    "category",
                    "source_split",
                    "source",
                    "license_id",
                ],
            )
            writer.writeheader()
            for index, row in enumerate(rows):
                writer.writerow(
                    {
                        "sample_id": "include-" + str(index).zfill(5),
                        "video_path": row["video_path"],
                        "gloss": row["label"],
                        "category": row["parent_label"],
                        "source_split": row["source_split"],
                        "source": "INCLUDE",
                        "license_id": REQUIRED_LICENSE,
                    }
                )

    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
