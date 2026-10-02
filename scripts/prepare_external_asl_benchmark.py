#!/usr/bin/env python3
"""Prepare an ephemeral external ASL browser benchmark.

Raw ASLLVD/VCD videos are downloaded only into an ignored work directory.
Do not commit or redistribute ASLLVD source video.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import re
import time
import urllib.request
from pathlib import Path


ASLLVD_METADATA = "https://dai.cs.rutgers.edu/asllvd/signbank/asllvd_signs_2024_06_27.csv"
WLASL_ASLLVD = "https://dai.cs.rutgers.edu/asllvd/signbank/wlasl_asllvd_split.csv"
ASLLVD_VIDEO_BASE = "https://dai.cs.rutgers.edu/asllvd/signs_mov_separ_signers"
VCD_LIST = "https://raw.githubusercontent.com/microsoft/VCD/main/download/mp4_list.txt"
VCD_BASE = "https://vcdpublic.blob.core.windows.net/vcd1"

TARGET_GLOSSES = [
    "HELLO", "NO", "YES", "PLEASE", "SORRY", "THANK YOU", "I LOVE YOU",
    "HELP", "BOOK", "COMPUTER", "WATER", "DRINK", "EAT", "MOTHER", "FATHER",
    "FAMILY", "WORK", "DOCTOR", "HOSPITAL", "SCHOOL", "GOOD", "BAD", "HOT",
    "COLD", "WHO", "WHAT", "WHERE", "WHY", "YESTERDAY", "TODAY", "TOMORROW",
    "NOW",
]

SPLIT_PRIORITY = {"test": 0, "val": 1, "train": 2}


def fetch_bytes(url: str, attempts: int = 3) -> bytes:
    last_error: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "SignRelay-research-evaluation/1.0"})
            with urllib.request.urlopen(request, timeout=60) as response:
                if response.status != 200:
                    raise RuntimeError(f"HTTP {response.status}")
                return response.read()
        except Exception as exc:
            last_error = exc
            if attempt < attempts:
                time.sleep(attempt)
    raise RuntimeError(f"Failed to fetch {url}: {last_error}")


def fetch_text(url: str) -> str:
    return fetch_bytes(url).decode("utf-8-sig")


def rows_from_csv(text: str) -> list[dict[str, str]]:
    return [dict(row) for row in csv.DictReader(io.StringIO(text))]


def canonical_gloss(value: str) -> str:
    value = value.strip().upper().replace("__", " ")
    value = re.sub(r"[_-]+", " ", value)
    value = value.replace("+", "")
    return re.sub(r"\s+", " ", value).strip()


def overlap_key(video_id: str) -> str | None:
    match = re.match(r"^(.*)--scene(\d+)-camera1--(\d+)_(\d+)$", video_id)
    if not match:
        return None
    session, scene, start, end = match.groups()
    return f"{session}_scene{scene}-camera1.mov|{start}|{end}"


def metadata_key(row: dict[str, str]) -> str:
    return "|".join([
        row.get("full video file", ""),
        row.get("start frame of video clip containing the sign (relative to full videos)", ""),
        row.get("end frame of video clip containing the sign (relative to full videos)", ""),
    ])


def safe_name(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")


def write_download(url: str, path: Path) -> dict[str, object]:
    payload = fetch_bytes(url)
    if len(payload) < 1024:
        raise RuntimeError(f"Downloaded file is unexpectedly small: {url}")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(payload)
    return {
        "bytes": len(payload),
        "sha256": hashlib.sha256(payload).hexdigest(),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=Path("work/external-asl-benchmark"))
    parser.add_argument("--per-gloss", type=int, default=2)
    parser.add_argument("--negatives", type=int, default=6)
    args = parser.parse_args()
    if args.per_gloss < 0 or args.negatives < 0:
        raise ValueError("fixture counts must be non-negative")

    root = args.output.resolve()
    videos = root / "videos"
    videos.mkdir(parents=True, exist_ok=True)

    print("Fetching ASLLVD metadata...")
    metadata = rows_from_csv(fetch_text(ASLLVD_METADATA))
    overlap = rows_from_csv(fetch_text(WLASL_ASLLVD))
    metadata_by_key = {metadata_key(row): row for row in metadata}

    grouped: dict[str, list[dict[str, object]]] = {gloss: [] for gloss in TARGET_GLOSSES}
    target_set = set(TARGET_GLOSSES)
    for row in overlap:
        if row.get("wlasl_data") != "0":
            continue
        gloss = canonical_gloss(row.get("CLASS_label", ""))
        if gloss not in target_set:
            continue
        key = overlap_key(row.get("video_id", ""))
        source_row = metadata_by_key.get(key or "")
        if source_row:
            grouped[gloss].append({"overlap": row, "source": source_row})

    manifest: list[dict[str, object]] = []
    inventory: list[dict[str, object]] = []
    missing: list[str] = []

    for gloss in TARGET_GLOSSES:
        candidates = grouped[gloss]
        candidates.sort(key=lambda item: (
            SPLIT_PRIORITY.get(str(item["overlap"].get("split", "")), 9),
            str(item["overlap"].get("signer_id", "")),
        ))
        selected: list[dict[str, object]] = []
        signers: set[str] = set()
        for candidate in candidates:
            if len(selected) >= args.per_gloss:
                break
            signer = str(candidate["overlap"].get("signer_id", ""))
            if not signer or signer in signers:
                continue
            selected.append(candidate)
            signers.add(signer)

        if not selected:
            missing.append(gloss)
            continue

        for index, candidate in enumerate(selected, start=1):
            overlap_row = candidate["overlap"]
            source_row = candidate["source"]
            signer = str(overlap_row.get("signer_id", ""))
            video_number = str(source_row.get("Video ID number", ""))
            filename = f"asllvd-{safe_name(gloss)}-{signer.lower()}-{video_number}.mp4"
            output = videos / filename
            source_url = f"{ASLLVD_VIDEO_BASE}/{signer}_{video_number}.mp4"
            try:
                info = write_download(source_url, output)
            except Exception as exc:
                print(f"WARNING: skipping unavailable ASLLVD clip {gloss}/{signer}: {exc}")
                continue

            manifest.append({
                "id": f"asllvd-{safe_name(gloss)}-{index}",
                "language": "asl",
                "trial_type": "sign",
                "expected_gloss": gloss,
                "video": output.relative_to(root).as_posix(),
                "condition": "ASLLVD studio front-view",
                "signer_id": f"ASLLVD-{signer}",
                "split": "cross-dataset",
                "source": "ASLLVD",
                "notes": (
                    f"ASLLVD class {overlap_row.get('CLASS_label')}; "
                    f"source split {overlap_row.get('split')}; "
                    f"video {overlap_row.get('video_id')}"
                ),
            })
            inventory.append({
                "source": "ASLLVD",
                "gloss": gloss,
                "signer": signer,
                "split": overlap_row.get("split"),
                "source_video_id": overlap_row.get("video_id"),
                "local_file": filename,
                "source_url": source_url,
                **info,
            })
            print(f"ASLLVD {gloss:<12} {signer:<6} {filename}")

    print("Fetching VCD talking-head negatives...")
    vcd_paths = [
        line.strip()
        for line in fetch_text(VCD_LIST).splitlines()
        if line.strip().startswith("mp4/th/")
    ][: args.negatives]

    for index, source_path in enumerate(vcd_paths, start=1):
        filename = f"vcd-nosign-{index:02d}.mp4"
        output = videos / filename
        source_url = f"{VCD_BASE}/{source_path}"
        info = write_download(source_url, output)
        manifest.append({
            "id": f"vcd-nosign-{index:02d}",
            "language": "asl",
            "trial_type": "no_sign",
            "expected_gloss": None,
            "video": output.relative_to(root).as_posix(),
            "condition": "VCD webcam talking-head ordinary speech/gesture",
            "signer_id": f"VCD-TH-{index:02d}",
            "split": "external-negative",
            "source": "Microsoft VCD",
            "notes": "Non-ASL talking-head video used only as a false-accept stress case.",
        })
        inventory.append({
            "source": "Microsoft VCD",
            "gloss": None,
            "signer": None,
            "split": "external-negative",
            "source_video_id": source_path,
            "local_file": filename,
            "source_url": source_url,
            **info,
        })
        print(f"VCD NO_SIGN     {filename}")

    if not manifest:
        raise RuntimeError("No benchmark fixtures could be downloaded")

    root.mkdir(parents=True, exist_ok=True)
    manifest_path = root / "manifest.jsonl"
    manifest_path.write_text(
        "".join(json.dumps(row, separators=(",", ":")) + "\n" for row in manifest),
        encoding="utf-8",
    )
    (root / "inventory.json").write_text(
        json.dumps({
            "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "sources": {
                "ASLLVD": {
                    "terms": "Research and education use; redistribution requires permission.",
                    "metadata": ASLLVD_METADATA,
                    "overlap": WLASL_ASLLVD,
                },
                "VCD": {
                    "terms": "Community Data License Agreement - Permissive 2.0.",
                    "list": VCD_LIST,
                },
            },
            "requested_glosses": TARGET_GLOSSES,
            "missing_glosses": missing,
            "fixtures": inventory,
        }, indent=2),
        encoding="utf-8",
    )

    print()
    print(f"Prepared {len(manifest)} fixtures")
    print("Missing requested ASLLVD glosses: " + (", ".join(missing) if missing else "none"))
    print(f"Manifest: {manifest_path}")


if __name__ == "__main__":
    main()
