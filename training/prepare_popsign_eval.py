#!/usr/bin/env python3
"""Prepare a small PopSign ASL test benchmark from official per-sign tar streams.

PopSign v1.0 is CC BY 4.0. This script downloads only enough of each official
test-split tar stream to collect a fixed number of unique signers, then stops
reading the response. Raw videos remain ignored by Git.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import tarfile
import urllib.request
from collections import defaultdict
from pathlib import Path


DEFAULT_TARGETS = {
    "hello": "HELLO",
    "no": "NO",
    "yes": "YES",
    "please": "PLEASE",
    "thankyou": "THANK YOU",
    "book": "BOOK",
    "chair": "CHAIR",
    "water": "WATER",
    "brother": "BROTHER",
    "bad": "BAD",
    "drink": "DRINK",
    "wait": "WAIT",
    "hot": "HOT",
    "who": "WHO",
    "why": "WHY",
    "yesterday": "YESTERDAY",
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def signer_from_filename(name: str) -> str:
    base = Path(name).name
    if "--" in base:
        return base.split("--", 1)[0]
    return base.split("-", 1)[0]


def safe_slug(value: str) -> str:
    return "".join(ch for ch in value.lower() if ch.isalnum() or ch in "-_")


def fetch_sign(dataset: str, category: str, split: str, source_slug: str, expected_gloss: str,
               per_sign: int, output_dir: Path) -> list[dict]:
    url = f"https://signdata.cc.gatech.edu/data/{dataset}/{category}/{split}/{source_slug}.tar"
    request = urllib.request.Request(url, headers={"User-Agent": "SignRelay-research-evaluation/1.0"})
    rows: list[dict] = []
    seen_signers: set[str] = set()

    with urllib.request.urlopen(request, timeout=120) as response:
        if response.status != 200:
            raise RuntimeError(f"{url} returned HTTP {response.status}")
        content_type = response.headers.get("Content-Type", "")
        if "html" in content_type.lower():
            raise RuntimeError(f"{url} returned HTML instead of a tar archive")

        # Streaming tar mode lets us stop after enough distinct signers without
        # downloading the rest of a potentially large sign archive.
        with tarfile.open(fileobj=response, mode="r|*") as archive:
            for member in archive:
                if not member.isfile() or not member.name.lower().endswith((".mp4", ".mov", ".m4v", ".webm")):
                    continue
                signer = signer_from_filename(member.name)
                if not signer or signer in seen_signers:
                    continue
                source = archive.extractfile(member)
                if source is None:
                    continue
                suffix = Path(member.name).suffix.lower() or ".mp4"
                destination = output_dir / f"{safe_slug(source_slug)}-{safe_slug(signer)}{suffix}"
                with source, destination.open("wb") as target:
                    shutil.copyfileobj(source, target)
                seen_signers.add(signer)
                rows.append({
                    "source_slug": source_slug,
                    "expected_gloss": expected_gloss,
                    "signer": signer,
                    "path": destination,
                    "sha256": sha256(destination),
                    "source_url": url,
                })
                if len(rows) >= per_sign:
                    break

    if not rows:
        raise RuntimeError(f"No video samples found for {source_slug!r} from {url}")
    return rows


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", default="popsign_v1_0")
    parser.add_argument("--category", default="game")
    parser.add_argument("--split", default="test")
    parser.add_argument("--per-sign", type=int, default=3)
    parser.add_argument("--output-dir", type=Path, default=Path("evaluation/videos/popsign"))
    parser.add_argument("--manifest", type=Path, default=Path("evaluation/popsign-test.local.jsonl"))
    parser.add_argument(
        "--target",
        action="append",
        default=[],
        metavar="SOURCE_SLUG=EXPECTED_GLOSS",
        help="Override defaults; repeat for multiple signs",
    )
    args = parser.parse_args()
    if args.per_sign <= 0:
        raise ValueError("--per-sign must be positive")

    targets = dict(DEFAULT_TARGETS)
    if args.target:
        targets = {}
        for item in args.target:
            if "=" not in item:
                raise ValueError("--target must use SOURCE_SLUG=EXPECTED_GLOSS")
            slug, gloss = item.split("=", 1)
            targets[safe_slug(slug)] = " ".join(gloss.strip().upper().split())

    args.output_dir.mkdir(parents=True, exist_ok=True)
    args.manifest.parent.mkdir(parents=True, exist_ok=True)

    records = []
    counts = defaultdict(int)
    all_signers = set()
    for source_slug, expected_gloss in targets.items():
        rows = fetch_sign(args.dataset, args.category, args.split, source_slug, expected_gloss,
                          args.per_sign, args.output_dir)
        for row in rows:
            counts[expected_gloss] += 1
            all_signers.add(row["signer"])
            relative = row["path"].relative_to(args.manifest.parent)
            records.append({
                "id": f"popsign-{source_slug}-{row['signer']}-{counts[expected_gloss]:02d}",
                "language": "asl",
                "trial_type": "sign",
                "expected_gloss": expected_gloss,
                "video": relative.as_posix(),
                "condition": "popsign-mobile-test",
                "device": "source-smartphone",
                "signer_id": row["signer"],
                "split": args.split,
                "source": "PopSign ASL v1.0 game/test (CC BY 4.0)",
                "notes": f"sha256={row['sha256']}; source={row['source_url']}",
            })

    args.manifest.write_text("\n".join(json.dumps(record) for record in records) + "\n", encoding="utf-8")
    print(json.dumps({
        "manifest": str(args.manifest),
        "clips": len(records),
        "unique_signers": len(all_signers),
        "prepared_per_gloss": dict(sorted(counts.items())),
        "dataset": args.dataset,
        "category": args.category,
        "split": args.split,
        "license": "CC BY 4.0",
    }, indent=2))


if __name__ == "__main__":
    main()
