#!/usr/bin/env python3
"""Prepare a small signer-independent ASL Citizen evaluation slice.

The script never redistributes ASL Citizen. It reads an official local ZIP or
extracted dataset, selects only rows from the official test split, copies a
small fixed set of clips into the ignored evaluation/videos tree, and writes a
metadata-only SignRelay video manifest.

ASL Citizen licence: research/non-commercial; do not commit or upload videos.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import random
import shutil
import urllib.request
import zipfile
from collections import OrderedDict
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path, PurePosixPath


DEFAULT_GLOSSES = [
    "HELLO",
    "NO",
    "YES",
    "PLEASE",
    "SORRY",
    "THANK YOU",
    "I LOVE YOU",
    "BOOK",
    "CHAIR",
    "HELP",
    "WATER",
    "MOTHER",
    "FAMILY",
    "COMPUTER",
    "WORK",
    "DOCTOR",
]


@dataclass(frozen=True)
class Row:
    signer: str
    filename: str
    gloss: str
    csv_path: str


def normalise_gloss(value: str) -> str:
    return " ".join(value.strip().upper().replace("_", " ").split())


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


class HTTPRangeFile(io.RawIOBase):
    """Small seekable HTTP reader for ZIP central-directory/random access."""

    def __init__(self, url: str, block_size: int = 1024 * 1024, cache_blocks: int = 32):
        self.url = url
        self.block_size = block_size
        self.cache_blocks = cache_blocks
        request = urllib.request.Request(url, method="HEAD")
        with urllib.request.urlopen(request, timeout=60) as response:
            length = response.headers.get("Content-Length")
            accept_ranges = response.headers.get("Accept-Ranges", "")
            self.etag = response.headers.get("ETag")
        if not length:
            raise RuntimeError("Remote archive did not provide Content-Length")
        if "bytes" not in accept_ranges.lower():
            raise RuntimeError("Remote archive does not advertise byte-range support")
        self.length = int(length)
        self.position = 0
        self.cache: OrderedDict[int, bytes] = OrderedDict()

    def readable(self) -> bool:
        return True

    def seekable(self) -> bool:
        return True

    def tell(self) -> int:
        return self.position

    def seek(self, offset: int, whence: int = io.SEEK_SET) -> int:
        if whence == io.SEEK_SET:
            target = offset
        elif whence == io.SEEK_CUR:
            target = self.position + offset
        elif whence == io.SEEK_END:
            target = self.length + offset
        else:
            raise ValueError(f"Unsupported whence: {whence}")
        if target < 0:
            raise OSError("Negative seek position")
        self.position = min(target, self.length)
        return self.position

    def _block(self, index: int) -> bytes:
        if index in self.cache:
            value = self.cache.pop(index)
            self.cache[index] = value
            return value
        start = index * self.block_size
        if start >= self.length:
            return b""
        end = min(self.length - 1, start + self.block_size - 1)
        request = urllib.request.Request(self.url, headers={"Range": f"bytes={start}-{end}"})
        with urllib.request.urlopen(request, timeout=120) as response:
            if response.status != 206:
                raise RuntimeError(f"Expected HTTP 206 for range request, got {response.status}")
            value = response.read()
            content_range = response.headers.get("Content-Range", "")
            if not content_range.startswith(f"bytes {start}-"):
                raise RuntimeError(f"Unexpected Content-Range: {content_range!r}")
        self.cache[index] = value
        while len(self.cache) > self.cache_blocks:
            self.cache.popitem(last=False)
        return value

    def read(self, size: int = -1) -> bytes:
        if self.position >= self.length:
            return b""
        if size is None or size < 0:
            size = self.length - self.position
        size = min(size, self.length - self.position)
        chunks = []
        remaining = size
        while remaining:
            block_index = self.position // self.block_size
            block_offset = self.position % self.block_size
            block = self._block(block_index)
            take = min(remaining, len(block) - block_offset)
            if take <= 0:
                break
            chunks.append(block[block_offset:block_offset + take])
            self.position += take
            remaining -= take
        return b"".join(chunks)


def find_test_csv_in_zip(archive: zipfile.ZipFile) -> tuple[str, list[Row]]:
    candidates = [name for name in archive.namelist() if name.lower().endswith(".csv") and "test" in name.lower()]
    if not candidates:
        candidates = [name for name in archive.namelist() if name.lower().endswith(".csv")]
    for name in sorted(candidates, key=lambda n: ("test" not in n.lower(), len(n))):
        try:
            text = archive.read(name).decode("utf-8-sig")
        except (UnicodeDecodeError, KeyError):
            continue
        parsed = parse_csv(text.splitlines(), name)
        if parsed:
            return name, parsed
    raise RuntimeError("Could not identify the ASL Citizen test CSV inside the archive")


def find_test_csv_in_directory(root: Path) -> tuple[Path, list[Row]]:
    candidates = list(root.rglob("*.csv"))
    candidates.sort(key=lambda p: ("test" not in p.name.lower(), len(str(p))))
    for path in candidates:
        parsed = parse_csv(path.read_text(encoding="utf-8-sig").splitlines(), str(path.relative_to(root)))
        if parsed and "test" in path.name.lower():
            return path, parsed
    raise RuntimeError("Could not identify an ASL Citizen test CSV in the extracted dataset")


def parse_csv(lines: list[str], source: str) -> list[Row]:
    reader = csv.reader(lines)
    header = next(reader, None)
    if not header or len(header) < 3:
        return []
    lowered = [item.strip().lower() for item in header]
    def index_for(names: tuple[str, ...], fallback: int) -> int:
        for name in names:
            if name in lowered:
                return lowered.index(name)
        return fallback

    signer_i = index_for(("user", "participant", "participant_id", "signer", "signer_id"), 0)
    file_i = index_for(("filename", "file", "video", "video_path"), 1)
    gloss_i = index_for(("gloss", "label", "sign"), 2)
    needed = max(signer_i, file_i, gloss_i)
    rows: list[Row] = []
    for raw in reader:
        if len(raw) <= needed:
            continue
        signer, filename, gloss = raw[signer_i].strip(), raw[file_i].strip(), raw[gloss_i].strip()
        if signer and filename and gloss:
            rows.append(Row(signer, filename, normalise_gloss(gloss), source))
    return rows


def locate_zip_member(archive: zipfile.ZipFile, filename: str) -> str:
    names = archive.namelist()
    exact = [name for name in names if name == filename or name.endswith("/" + filename)]
    if len(exact) == 1:
        return exact[0]
    basename = PurePosixPath(filename).name
    by_basename = [name for name in names if PurePosixPath(name).name == basename]
    if len(by_basename) == 1:
        return by_basename[0]
    raise RuntimeError(f"Could not uniquely locate video {filename!r} in archive")


def locate_directory_file(root: Path, filename: str) -> Path:
    direct = root / filename
    if direct.is_file():
        return direct
    matches = list(root.rglob(Path(filename).name))
    if len(matches) == 1:
        return matches[0]
    raise RuntimeError(f"Could not uniquely locate video {filename!r} under {root}")


def select(rows: list[Row], glosses: list[str], per_gloss: int, seed: int) -> list[Row]:
    randomizer = random.Random(seed)
    by_gloss: dict[str, list[Row]] = defaultdict(list)
    for row in rows:
        by_gloss[row.gloss].append(row)

    selected: list[Row] = []
    missing: list[str] = []
    for gloss in glosses:
        candidates = list(by_gloss[gloss])
        if not candidates:
            missing.append(gloss)
            continue
        randomizer.shuffle(candidates)
        # Maximise signer diversity before taking repeated clips from one signer.
        by_signer: dict[str, list[Row]] = defaultdict(list)
        for row in candidates:
            by_signer[row.signer].append(row)
        signers = sorted(by_signer)
        randomizer.shuffle(signers)
        chosen: list[Row] = []
        while signers and len(chosen) < per_gloss:
            next_round = []
            for signer in signers:
                bucket = by_signer[signer]
                if bucket and len(chosen) < per_gloss:
                    chosen.append(bucket.pop())
                if bucket:
                    next_round.append(signer)
            signers = next_round
        selected.extend(chosen)

    if missing:
        print("Glosses not present in official test CSV:", ", ".join(missing))
    if not selected:
        raise RuntimeError("None of the requested glosses were found in the official test split")
    return selected


def main() -> None:
    parser = argparse.ArgumentParser()
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--zip", type=Path, help="Official ASL_Citizen.zip")
    source.add_argument("--root", type=Path, help="Extracted ASL Citizen directory")
    source.add_argument("--url", help="Official ASL Citizen ZIP URL; fetched lazily with HTTP range requests")
    parser.add_argument("--output-dir", type=Path, default=Path("evaluation/videos/asl-citizen"))
    parser.add_argument("--manifest", type=Path, default=Path("evaluation/asl-citizen-test.local.jsonl"))
    parser.add_argument("--per-gloss", type=int, default=4)
    parser.add_argument("--seed", type=int, default=20261002)
    parser.add_argument("--gloss", action="append", default=[], help="Exact gloss; repeat to override defaults")
    args = parser.parse_args()
    if args.per_gloss <= 0:
        raise ValueError("--per-gloss must be positive")

    requested = [normalise_gloss(item) for item in (args.gloss or DEFAULT_GLOSSES)]
    args.output_dir.mkdir(parents=True, exist_ok=True)
    args.manifest.parent.mkdir(parents=True, exist_ok=True)

    if args.zip or args.url:
        remote = HTTPRangeFile(args.url) if args.url else None
        archive_source = remote if remote is not None else args.zip
        with zipfile.ZipFile(archive_source) as archive:
            csv_path, rows = find_test_csv_in_zip(archive)
            chosen = select(rows, requested, args.per_gloss, args.seed)
            prepared = []
            for index, row in enumerate(chosen, 1):
                member = locate_zip_member(archive, row.filename)
                suffix = Path(row.filename).suffix.lower() or ".mp4"
                destination = args.output_dir / f"{index:03d}-{row.signer}-{row.gloss.lower().replace(' ', '-')}{suffix}"
                with archive.open(member) as source_handle, destination.open("wb") as destination_handle:
                    shutil.copyfileobj(source_handle, destination_handle)
                prepared.append((row, destination, csv_path))
    else:
        csv_path_obj, rows = find_test_csv_in_directory(args.root)
        chosen = select(rows, requested, args.per_gloss, args.seed)
        prepared = []
        for index, row in enumerate(chosen, 1):
            source_path = locate_directory_file(args.root, row.filename)
            suffix = source_path.suffix.lower() or ".mp4"
            destination = args.output_dir / f"{index:03d}-{row.signer}-{row.gloss.lower().replace(' ', '-')}{suffix}"
            shutil.copy2(source_path, destination)
            prepared.append((row, destination, str(csv_path_obj.relative_to(args.root))))

    lines = []
    per_gloss_counts: dict[str, int] = defaultdict(int)
    signers = set()
    for row, destination, csv_path in prepared:
        per_gloss_counts[row.gloss] += 1
        signers.add(row.signer)
        relative_video = destination.relative_to(args.manifest.parent)
        record = {
            "id": f"asl-citizen-{row.gloss.lower().replace(' ', '-')}-{row.signer}-{per_gloss_counts[row.gloss]:02d}",
            "language": "asl",
            "trial_type": "sign",
            "expected_gloss": row.gloss,
            "video": relative_video.as_posix(),
            "condition": "asl-citizen-webcam",
            "device": "source-webcam",
            "signer_id": row.signer,
            "split": "test",
            "source": "ASL Citizen v1.0 official test split",
            "notes": f"metadata={csv_path}; sha256={sha256(destination)}",
        }
        lines.append(json.dumps(record, ensure_ascii=False))

    args.manifest.write_text("\n".join(lines) + "\n", encoding="utf-8")
    report = {
        "manifest": str(args.manifest),
        "clips": len(prepared),
        "signers": len(signers),
        "requested_glosses": requested,
        "prepared_per_gloss": dict(sorted(per_gloss_counts.items())),
        "seed": args.seed,
        "research_only": True,
        "do_not_commit_videos": True,
    }
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
