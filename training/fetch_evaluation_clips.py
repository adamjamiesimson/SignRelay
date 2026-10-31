"""Fetch frozen CC BY 4.0 PopSign clips; keep raw video on this runner only."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import tempfile

from secure_download import get, official_url


def fetch(manifest: Path, cohort_lock: Path, *, final_holdout=False, clip_cache: Path | None = None):
    rows = json.loads(manifest.read_text(encoding="utf-8"))
    sealed = set()
    for entry in json.loads(cohort_lock.read_text(encoding="utf-8"))["manifests"]:
        if entry["role"] == "sealed-holdout":
            sealed.update(item["recording_sha256"] for item in json.loads(Path(entry["file"]).read_text(encoding="utf-8")))
    requested = [row["trial_id"] for row in rows if row.get("recording_sha256") in sealed]
    if requested and not final_holdout:
        raise ValueError(f"Refusing to fetch {len(requested)} sealed holdout clip(s); authorized --final-holdout required")
    root = Path.cwd().resolve() / "evaluation" / "videos"
    for row in rows:
        path = Path(row["file"])
        if (path.is_absolute() or ".." in path.parts or path.parts[:2] != ("evaluation", "videos")
                or not path.resolve().is_relative_to(root)):
            raise ValueError("Evaluation output must stay in evaluation/videos/")
        official_url(row["source"])
        if row.get("license") != "CC BY 4.0":
            raise ValueError("Frozen clip must preserve its reviewed CC BY 4.0 license")
        start, size, digest = int(row["archive_offset"]), int(row["bytes"]), row["recording_sha256"]
        if start < 0 or not 0 < size < 100 * 1024 * 1024 or len(digest) != 64 or any(c not in "0123456789abcdef" for c in digest):
            raise ValueError("Invalid frozen source range or fingerprint")

        def valid(candidate):
            return candidate.is_file() and candidate.stat().st_size == size and hashlib.sha256(candidate.read_bytes()).hexdigest() == digest

        if valid(path):
            print(f"Verified cached clip {row['trial_id']}")
            continue
        cached = clip_cache / f"{digest}.mp4" if clip_cache else None
        if cached and cached.exists():
            if not valid(cached):
                raise ValueError(f"Local recovery clip differs from frozen size/SHA-256: {digest}")
            data = cached.read_bytes()
        else:
            data = get(row["source"], start, size, sha256=digest)
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as handle:
                temporary = Path(handle.name)
                handle.write(data)
            os.replace(temporary, path)
        finally:
            if temporary:
                temporary.unlink(missing_ok=True)
        print(f"Verified clip {row['trial_id']}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path, nargs="?", default=Path("docs/evaluation/popsign-project-holdout-manifest.json"))
    parser.add_argument("--cohort-lock", type=Path, default=Path("docs/evaluation/cohort-lock-2026-10-16.json"))
    parser.add_argument("--final-holdout", action="store_true", help="Authorized once-only final measurement; never development")
    parser.add_argument("--clip-cache", type=Path, help="Existing licensed local copies named <frozen-sha256>.mp4")
    args = parser.parse_args()
    try:
        fetch(args.manifest, args.cohort_lock, final_holdout=args.final_holdout, clip_cache=args.clip_cache)
    except (RuntimeError, ValueError) as error:
        parser.exit(1, f"Frozen clip acquisition blocked: {error}\n")


if __name__ == "__main__":
    main()
