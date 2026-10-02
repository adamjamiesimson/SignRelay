#!/usr/bin/env python3
"""Prepare a local-only ASL Citizen test benchmark for SignRelay.

ASL Citizen's dataset agreement is stricter than the code repository's MIT
licence. This helper never downloads or uploads the dataset. Point it at the
official ASL_Citizen.zip you obtained under the dataset terms. It extracts only
selected TEST videos into ignored work/, pseudonymises signer identifiers, and
writes a manifest compatible with scripts/evaluate-video-regressions.mjs.

Do not commit the source archive, extracted clips, or generated local manifest.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import os
import re
import shutil
import sys
import zipfile
from collections import defaultdict
from pathlib import Path, PurePosixPath


DEFAULT_GLOSSES = [
    "HELLO", "NO", "YES", "PLEASE", "SORRY", "THANK YOU", "I LOVE YOU",
    "HELP", "BOOK", "COMPUTER", "WATER", "DRINK", "EAT", "MOTHER", "FATHER",
    "FAMILY", "WORK", "DOCTOR", "HOSPITAL", "SCHOOL", "GOOD", "BAD", "HOT",
    "COLD", "WHO", "WHAT", "WHERE", "WHY", "YESTERDAY", "TODAY", "TOMORROW",
    "NOW",
]


def canonical(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip().upper().replace("_", " "))


def safe(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")


def csv_rows(payload: bytes) -> list[list[str]]:
    text = payload.decode("utf-8-sig")
    return list(csv.reader(io.StringIO(text, newline="")))


def looks_like_split_csv(rows: list[list[str]]) -> bool:
    if len(rows) < 2 or len(rows[0]) < 3:
        return False
    header = [cell.strip().lower() for cell in rows[0]]
    joined = " ".join(header)
    if "filename" in joined and ("gloss" in joined or "label" in joined):
        return True
    # Official baseline reads row[0]=user, row[1]=filename, row[2]=gloss.
    sample = rows[1]
    return len(sample) >= 3 and bool(re.search(r"\.(mp4|mov|webm)$", sample[1], re.I))


def column_indices(header: list[str]) -> tuple[int, int, int]:
    lower = [cell.strip().lower() for cell in header]

    def find(names: tuple[str, ...], fallback: int) -> int:
        for index, name in enumerate(lower):
            if any(token == name or token in name for token in names):
                return index
        return fallback

    return (
        find(("user", "participant", "signer"), 0),
        find(("filename", "file", "video"), 1),
        find(("gloss", "label", "sign"), 2),
    )


def discover_split_csvs(archive: zipfile.ZipFile) -> dict[str, tuple[str, list[list[str]]]]:
    found: dict[str, list[tuple[str, list[list[str]]]]] = defaultdict(list)
    for name in archive.namelist():
        if not name.lower().endswith(".csv"):
            continue
        base = PurePosixPath(name).name.lower()
        split = next((candidate for candidate in ("train", "val", "test") if candidate in base), None)
        if not split:
            continue
        try:
            rows = csv_rows(archive.read(name))
        except Exception:
            continue
        if looks_like_split_csv(rows):
            found[split].append((name, rows))

    selected: dict[str, tuple[str, list[list[str]]]] = {}
    for split, candidates in found.items():
        selected[split] = max(candidates, key=lambda item: len(item[1]))
    return selected


def parse_records(rows: list[list[str]]) -> list[dict[str, str]]:
    user_i, file_i, gloss_i = column_indices(rows[0])
    records = []
    for row in rows[1:]:
        if max(user_i, file_i, gloss_i) >= len(row):
            continue
        user = row[user_i].strip()
        filename = row[file_i].strip().replace("\\", "/")
        gloss = canonical(row[gloss_i])
        if user and filename and gloss:
            records.append({"user": user, "filename": filename, "gloss": gloss})
    return records


def validate_split_users(splits: dict[str, list[dict[str, str]]]) -> dict[str, object]:
    users = {name: {row["user"] for row in rows} for name, rows in splits.items()}
    overlaps = {}
    names = sorted(users)
    for i, left in enumerate(names):
        for right in names[i + 1:]:
            overlap = users[left] & users[right]
            if overlap:
                overlaps[f"{left}:{right}"] = len(overlap)
    return {
        "user_counts": {name: len(values) for name, values in users.items()},
        "cross_split_user_overlap": overlaps,
    }


def build_archive_index(archive: zipfile.ZipFile) -> tuple[set[str], dict[str, list[str]]]:
    exact = set(archive.namelist())
    by_basename: dict[str, list[str]] = defaultdict(list)
    for name in archive.namelist():
        if name.endswith("/"):
            continue
        by_basename[PurePosixPath(name).name].append(name)
    return exact, by_basename


def resolve_member(filename: str, exact: set[str], by_basename: dict[str, list[str]]) -> str:
    normalized = filename.lstrip("./")
    if normalized in exact:
        return normalized

    suffix_matches = [name for name in exact if name.endswith("/" + normalized)]
    if len(suffix_matches) == 1:
        return suffix_matches[0]

    matches = by_basename.get(PurePosixPath(normalized).name, [])
    if len(matches) == 1:
        return matches[0]

    raise FileNotFoundError(
        f"Could not uniquely resolve {filename!r} inside the ASL Citizen archive "
        f"({len(matches)} basename matches)"
    )


def pseudonym(user: str, salt: str) -> str:
    digest = hashlib.sha256(f"{salt}\0{user}".encode()).hexdigest()[:10]
    return f"AC-{digest}"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def ensure_ignored_output(path: Path, repo_root: Path) -> None:
    work_root = (repo_root / "work").resolve()
    try:
        path.resolve().relative_to(work_root)
    except ValueError as exc:
        raise ValueError(
            "For privacy/licence safety, output must remain under this repository's ignored work/ directory."
        ) from exc


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("archive", type=Path, help="Path to official ASL_Citizen.zip")
    parser.add_argument("--output", type=Path, default=Path("work/asl-citizen-local-benchmark"))
    parser.add_argument("--per-gloss", type=int, default=2)
    parser.add_argument(
        "--gloss",
        action="append",
        default=[],
        help="Target gloss. Repeat as needed; default is SignRelay's common benchmark list.",
    )
    parser.add_argument(
        "--replace-output",
        action="store_true",
        help="Delete an existing output directory before extracting the new local fixture set.",
    )
    args = parser.parse_args()

    if args.per_gloss <= 0:
        raise ValueError("--per-gloss must be positive")
    archive_path = args.archive.expanduser().resolve()
    if not archive_path.is_file():
        raise FileNotFoundError(archive_path)

    repo_root = Path(__file__).resolve().parents[1]
    output = (repo_root / args.output).resolve() if not args.output.is_absolute() else args.output.resolve()
    ensure_ignored_output(output, repo_root)
    if output.exists() and args.replace_output:
        shutil.rmtree(output)
    output.mkdir(parents=True, exist_ok=True)
    video_dir = output / "videos"
    video_dir.mkdir(parents=True, exist_ok=True)

    targets = [canonical(value) for value in (args.gloss or DEFAULT_GLOSSES)]
    target_set = set(targets)

    archive_hash = sha256_file(archive_path)
    salt = archive_hash[:16]

    with zipfile.ZipFile(archive_path) as archive:
        discovered = discover_split_csvs(archive)
        if "test" not in discovered:
            raise RuntimeError(
                "Could not find an ASL Citizen test CSV in the archive. "
                "Expected a CSV whose filename contains 'test' and rows shaped like user, filename, gloss."
            )

        parsed = {name: parse_records(rows) for name, (_, rows) in discovered.items()}
        integrity = validate_split_users(parsed)
        if integrity["cross_split_user_overlap"]:
            raise RuntimeError(
                "ASL Citizen split metadata unexpectedly contains users in multiple splits: "
                + json.dumps(integrity["cross_split_user_overlap"])
            )

        test_rows = parsed["test"]
        grouped: dict[str, list[dict[str, str]]] = defaultdict(list)
        for row in test_rows:
            if row["gloss"] in target_set:
                grouped[row["gloss"]].append(row)

        exact, by_basename = build_archive_index(archive)
        manifest = []
        inventory = []
        missing = []

        for gloss in targets:
            selected = []
            seen_users = set()
            for row in grouped.get(gloss, []):
                if row["user"] in seen_users:
                    continue
                selected.append(row)
                seen_users.add(row["user"])
                if len(selected) >= args.per_gloss:
                    break
            if not selected:
                missing.append(gloss)
                continue

            for occurrence, row in enumerate(selected, start=1):
                member = resolve_member(row["filename"], exact, by_basename)
                signer = pseudonym(row["user"], salt)
                suffix = Path(row["filename"]).suffix.lower()
                if suffix not in {".mp4", ".mov", ".webm", ".m4v"}:
                    suffix = ".mp4"
                local_name = f"asl-citizen-{safe(gloss)}-{signer.lower()}-{occurrence}{suffix}"
                local_path = video_dir / local_name
                with archive.open(member) as source, local_path.open("wb") as destination:
                    shutil.copyfileobj(source, destination, length=1024 * 1024)
                clip_hash = sha256_file(local_path)

                manifest.append({
                    "id": f"asl-citizen-{safe(gloss)}-{occurrence}",
                    "language": "asl",
                    "trial_type": "sign",
                    "expected_gloss": gloss,
                    "video": local_path.relative_to(output).as_posix(),
                    "condition": "ASL Citizen community webcam test split",
                    "signer_id": signer,
                    "split": "test",
                    "source": "ASL Citizen v1.0 local-only",
                    "notes": "Official signer-disjoint test split; source identifiers intentionally omitted.",
                })
                inventory.append({
                    "fixture_id": manifest[-1]["id"],
                    "gloss": gloss,
                    "signer": signer,
                    "local_file": local_name,
                    "sha256": clip_hash,
                    "bytes": local_path.stat().st_size,
                })

    (output / "manifest.jsonl").write_text(
        "".join(json.dumps(row, separators=(",", ":")) + "\n" for row in manifest),
        encoding="utf-8",
    )
    (output / "inventory.json").write_text(
        json.dumps({
            "source": "ASL Citizen v1.0",
            "archive_sha256": archive_hash,
            "split_csv_members": {name: member for name, (member, _) in discovered.items()},
            "split_integrity": integrity,
            "requested_glosses": targets,
            "missing_glosses": missing,
            "fixture_count": len(manifest),
            "fixtures": inventory,
            "privacy": (
                "Signer IDs are one-way pseudonyms salted by the local archive hash. "
                "Original ASL Citizen participant IDs and filenames are not written to outputs."
            ),
        }, indent=2),
        encoding="utf-8",
    )

    print(f"Prepared {len(manifest)} local-only ASL Citizen test fixtures.")
    print(f"Signer-disjoint split audit: {json.dumps(integrity)}")
    print("Missing requested glosses: " + (", ".join(missing) if missing else "none"))
    print(f"Manifest: {output / 'manifest.jsonl'}")
    print()
    print("Run locally:")
    print("  npm run build:firebase")
    print(f"  npm run eval:video -- {output / 'manifest.jsonl'} --language asl --strict")
    print()
    print("Do not upload ASL Citizen raw videos or this extracted work directory.")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"ASL Citizen benchmark preparation failed: {exc}", file=sys.stderr)
        raise
