"""Resumable downloader for an official WLASL vocabulary extension.

Run only after the person responsible for the data has accepted WLASL's C-UDA.
Raw videos stay outside the web app and are never committed or deployed.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
import urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, asdict
from pathlib import Path


USER_AGENT = "SignRelay academic research downloader/1.0 (respectful rate-limited access)"


@dataclass
class Download:
    video_id: str
    url: str
    gloss: str
    split: str
    source: str
    output: str
    status: str = "pending"
    detail: str = ""


def source_name(url: str) -> str:
    return url.split("/")[2].lower() if "://" in url else "unknown"


def is_youtube(url: str) -> bool:
    return "youtube.com" in url or "youtu.be" in url


def is_video_file(path: Path) -> bool:
    with path.open("rb") as handle:
        header = handle.read(16)
    return header[4:8] == b"ftyp" or header.startswith(b"\x1aE\xdf\xa3") or header[:3] in {b"FWS", b"CWS", b"ZWS"}


def fetch_direct(url: str, output: Path) -> None:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=45) as response, output.open("wb") as handle:
        while chunk := response.read(1024 * 1024):
            handle.write(chunk)


def fetch_youtube(url: str, output_template: Path) -> None:
    command = [
        sys.executable, "-m", "yt_dlp", "--no-playlist", "--retries", "2", "--socket-timeout", "30", "--js-runtimes", "node",
        "--format", "best[ext=mp4][vcodec!=none][acodec!=none]/best[ext=mp4]/best",
        "--concurrent-fragments", "1", "--restrict-filenames", "--output", str(output_template), url,
    ]
    completed = subprocess.run(command, capture_output=True, text=True, timeout=360)
    if completed.returncode:
        raise RuntimeError((completed.stderr or completed.stdout).strip()[-500:])


def download_one(record: Download, raw_dir: Path, delay_seconds: float) -> Download:
    target = Path(record.output)
    try:
        if is_youtube(record.url):
            for stale in raw_dir.glob(f"{record.video_id}.*"):
                stale.unlink(missing_ok=True)
            template = target.with_name(f"{record.video_id}.%(ext)s")
            fetch_youtube(record.url, template)
            matches = sorted(
                (path for path in raw_dir.glob(f"{record.video_id}.*") if is_video_file(path)),
                key=lambda path: path.stat().st_size,
                reverse=True,
            )
            if not matches:
                raise RuntimeError("yt-dlp did not create a valid media file")
            target = matches[0]
            record.output = str(target)
        else:
            fetch_direct(record.url, target)
        if target.stat().st_size < 1024 or not is_video_file(target):
            raise RuntimeError("downloaded file is not valid media")
        record.status = "downloaded"
    except Exception as error:  # Preserve errors and continue with other publisher-hosted clips.
        target.unlink(missing_ok=True)
        for stale in raw_dir.glob(f"{record.video_id}.*"):
            stale.unlink(missing_ok=True)
        record.status = "failed"
        record.detail = str(error)[:500]
    finally:
        time.sleep(delay_seconds)
    return record


def write_json_atomic(path: Path, value: object) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2), encoding="utf-8")
    temporary.replace(path)


def eligible_entries(
    metadata: Path,
    classes: int,
    skip_first: int,
    direct_only: bool,
    require_direct_splits: bool,
) -> list[tuple[int, dict, list[dict]]]:
    entries = json.loads(metadata.read_text(encoding="utf-8"))
    if not isinstance(entries, list) or len(entries) < skip_first + classes:
        raise ValueError(
            "Expected the official WLASL_v0.3.json file with enough glosses "
            f"for skip_first={skip_first} and classes={classes}"
        )

    selected: list[tuple[int, dict, list[dict]]] = []
    required_splits = {"train", "val", "test"}
    for rank, entry in enumerate(entries[skip_first:], start=skip_first + 1):
        instances = [
            instance
            for instance in entry["instances"]
            if str(instance.get("url", "")).strip()
            and str(instance.get("video_id", "")).strip()
            and (not direct_only or not is_youtube(str(instance["url"])))
        ]
        splits = {str(instance.get("split", "")).strip() for instance in instances}
        if require_direct_splits and not required_splits.issubset(splits):
            continue
        selected.append((rank, entry, instances))
        if len(selected) == classes:
            return selected

    raise ValueError(
        f"Only {len(selected)} eligible glosses were found after skipping the first "
        f"{skip_first}; requested {classes}"
    )


def planned_downloads(
    metadata: Path,
    output: Path,
    classes: int,
    skip_first: int,
    direct_only: bool,
    require_direct_splits: bool,
) -> tuple[list[Download], list[dict]]:
    selected = eligible_entries(
        metadata,
        classes,
        skip_first,
        direct_only,
        require_direct_splits,
    )
    per_gloss: list[list[Download]] = []
    vocabulary: list[dict] = []
    for extension_index, (rank, entry, instances) in enumerate(selected):
        gloss = str(entry["gloss"]).strip()
        records: list[Download] = []
        for instance in instances:
            url = str(instance["url"]).strip()
            video_id = str(instance["video_id"]).strip()
            records.append(Download(
                video_id=video_id,
                url=url,
                gloss=gloss,
                split=str(instance.get("split", "")).strip(),
                source=source_name(url),
                output=str(output / "raw" / f"{video_id}.source"),
            ))
        records.sort(key=lambda record: ({"train": 0, "val": 1, "test": 2}.get(record.split, 3), record.video_id))
        per_gloss.append(records)
        vocabulary.append({
            "extension_index": extension_index,
            "combined_index": skip_first + extension_index,
            "wlasl_rank": rank,
            "gloss": gloss,
            "instances": len(records),
            "splits": dict(sorted(Counter(record.split for record in records).items())),
            "sources": dict(sorted(Counter(record.source for record in records).items())),
        })

    # The first 3 * classes records give every label one train, validation and
    # test attempt before extras. Remaining clips are round-robin by label.
    ordered: list[Download] = []
    used: set[str] = set()
    for split in ("train", "val", "test"):
        for records in per_gloss:
            first = next((record for record in records if record.split == split), None)
            if first is not None:
                ordered.append(first)
                used.add(first.video_id)

    remaining = [[record for record in records if record.video_id not in used] for records in per_gloss]
    while any(remaining):
        for records in remaining:
            if records:
                ordered.append(records.pop(0))

    return ordered, vocabulary


def main() -> None:
    parser = argparse.ArgumentParser(description="Download an official WLASL extension with a resumable audit log")
    parser.add_argument("metadata", type=Path, help="Official WLASL_v0.3.json")
    parser.add_argument("--output", type=Path, default=Path("artifacts/wlasl500-source"))
    parser.add_argument("--classes", type=int, default=500, help="Number of new extension glosses")
    parser.add_argument("--skip-first", type=int, default=100, help="Preserve the existing top-100 WLASL model")
    parser.add_argument("--max-downloads", type=int, default=100, help="Use 0 only after confirming sufficient disk and time")
    parser.add_argument("--delay-seconds", type=float, default=1.0)
    parser.add_argument("--workers", type=int, default=3, help="Concurrent source requests (1-8)")
    parser.add_argument("--direct-only", action="store_true", help="Skip YouTube when it is unavailable and prioritise publisher-hosted clips")
    parser.add_argument(
        "--require-direct-splits",
        action="store_true",
        help="Select only glosses with eligible publisher clips in train, validation and test",
    )
    parser.add_argument("--confirm-cuda", action="store_true", help="Record that the data user accepted WLASL's C-UDA")
    args = parser.parse_args()
    if not args.confirm_cuda:
        raise SystemExit("Refusing to download: pass --confirm-cuda only after the data user has accepted WLASL's C-UDA")
    if args.max_downloads < 0:
        raise ValueError("max-downloads must be zero or positive")
    if not 1 <= args.workers <= 8:
        raise ValueError("workers must be between 1 and 8")
    if not 1 <= args.classes <= 1900:
        raise ValueError("classes must be between 1 and 1,900 extension glosses")
    if not 0 <= args.skip_first <= 1999:
        raise ValueError("skip-first must be between 0 and 1,999")

    raw_dir = args.output / "raw"
    raw_dir.mkdir(parents=True, exist_ok=True)
    audit_path = args.output / "download-audit.json"
    prior = {item["video_id"]: item for item in json.loads(audit_path.read_text(encoding="utf-8"))} if audit_path.exists() else {}
    records, vocabulary = planned_downloads(
        args.metadata,
        args.output,
        args.classes,
        args.skip_first,
        args.direct_only,
        args.require_direct_splits,
    )
    write_json_atomic(args.output / "selected-vocabulary.json", vocabulary)
    pending: list[Download] = []
    for record in records:
        previous = prior.get(record.video_id)
        if previous and previous.get("status") == "downloaded" and Path(previous["output"]).exists():
            record.status = "downloaded"
            record.detail = "resumed"
            continue
        pending.append(record)
        if args.max_downloads and len(pending) >= args.max_downloads:
            break

    attempted = len(pending)
    with ThreadPoolExecutor(max_workers=args.workers) as executor:
        futures = {
            executor.submit(download_one, record, raw_dir, args.delay_seconds): record.video_id
            for record in pending
        }
        for future in as_completed(futures):
            record = future.result()
            prior[record.video_id] = asdict(record)
            write_json_atomic(audit_path, list(prior.values()))

    all_records = list(prior.values())
    selected_ids = {record.video_id for record in records}
    selected_records = [item for item in all_records if item.get("video_id") in selected_ids]
    downloaded = sum(item.get("status") == "downloaded" for item in selected_records)
    failed = sum(item.get("status") == "failed" for item in selected_records)
    covered = len({item["gloss"] for item in selected_records if item.get("status") == "downloaded"})
    print(json.dumps({
        "new_classes": args.classes,
        "combined_classes": args.skip_first + args.classes,
        "planned": len(records),
        "downloaded": downloaded,
        "failed": failed,
        "covered_glosses": covered,
        "attempted_this_run": attempted,
        "vocabulary": str(args.output / "selected-vocabulary.json"),
        "audit": str(audit_path),
    }, indent=2))


if __name__ == "__main__":
    main()
