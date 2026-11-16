"""Build a larger development replay cohort from PopSign ASL v1.0 (CC BY 4.0).

The 11 inspected development clips are too few to say anything about recall or
wrong words. This fetches, by byte range, a predetermined sample of the
publisher's game/test split so the production browser pipeline can be replayed
on a few hundred recordings from many signers:

- targets: the five demo signs PopSign contains (HELLO, THANK YOU, PLEASE, YES,
  NO; PopSign has no SORRY), one clip from each of the first --target-signers
  signers in archive order;
- other signs: the first --other-signs published signs of a fixed list, one
  clip from each of the first --other-signers signers. Any of the six demo words on
  these clips is a wrong word.

Selection is fixed by this file (sign lists, archive order) before any
result exists. Sealed-holdout signers and every recording already in a frozen
cohort are skipped using manifest metadata only; sealed clips are never
requested. The result is DEVELOPMENT evidence: publisher labels, no fluent
review, and once replayed these clips are exposed. Videos stay in the ignored
evaluation/videos/ and are never committed or uploaded.

Writes the manifest and an extended cohort lock that keeps every original
cohort unchanged.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import time
from pathlib import Path
from urllib.parse import urlparse
from urllib.error import HTTPError
from urllib.request import Request, urlopen

BASE = "https://signdata.cc.gatech.edu/data/popsign_v1_0/game"
TARGETS = {"hello": "HELLO", "thankyou": "THANK YOU", "please": "PLEASE", "yes": "YES", "no": "NO"}
# Other PopSign signs, fixed here before any result exists (alphabetical; the
# first --other-signs that exist are used). Any of the six demo words on these
# clips is a wrong word.
OTHER_SIGNS = ["after", "apple", "bird", "book", "brother", "cat", "cow", "dad", "dog", "drink", "fish", "girl", "go",
               "happy", "horse", "hot", "mom", "sad", "shoe", "water", "bed", "blue", "car", "chair", "eat", "milk"]
LOCK = Path("docs/evaluation/cohort-lock-2026-10-16.json")


def get(url: str, start: int | None = None, size: int | None = None) -> bytes:
    """Bounded HTTPS read from the official host only, TLS verification on."""
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.netloc != "signdata.cc.gatech.edu":
        raise ValueError("Only the reviewed official PopSign source is supported")
    if size is not None and not 0 < size <= 100 * 1024 * 1024:
        raise ValueError("Invalid range")
    headers = {"User-Agent": "SignRelay evaluation (CC BY 4.0 PopSign; low-rate range requests)"}
    if start is not None:
        headers["Range"] = f"bytes={start}-{start + size - 1}"
    for attempt in range(4):
        try:
            with urlopen(Request(url, headers=headers), timeout=60) as response:
                if start is not None and response.status != 206:
                    raise ValueError("Source must honor byte-range requests")
                data = response.read((size or 4 * 1024 * 1024) + 1)
            if size is not None and len(data) != size:
                raise ValueError("Short range read")
            return data
        except ValueError:
            raise
        except HTTPError as error:
            if error.code in (403, 404):
                raise FileNotFoundError(url) from error
            if attempt == 3:
                raise
            time.sleep(2 ** attempt)
        except Exception:  # network errors only; retried with backoff
            if attempt == 3:
                raise
            time.sleep(2 ** attempt)
    raise RuntimeError("unreachable")


def members(url: str, limit: int):
    """Yield (name, data_offset, size) for regular tar members, header by header."""
    offset, long_name = 0, None
    for _ in range(limit):
        header = get(url, offset, 512)
        if header == b"\0" * 512:
            return
        size = int(header[124:136].rstrip(b"\0 ").decode() or "0", 8)
        kind = header[156:157]
        name = header[0:100].rstrip(b"\0").decode("utf-8", "replace")
        prefix = header[345:500].rstrip(b"\0").decode("utf-8", "replace")
        data = offset + 512
        if kind == b"L":
            long_name = get(url, data, size).rstrip(b"\0").decode("utf-8", "replace")
        elif kind in (b"0", b"\0"):
            yield (long_name or (f"{prefix}/{name}" if prefix else name)), data, size
            long_name = None
        offset = data + (size + 511) // 512 * 512


def normalise(value: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", value.upper())


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("lock", type=Path)
    parser.add_argument("--split", default="test")
    parser.add_argument("--target-signers", type=int, default=10)
    parser.add_argument("--other-signs", type=int, default=30)
    parser.add_argument("--other-signers", type=int, default=2)
    parser.add_argument("--max-headers", type=int, default=400)
    parser.add_argument("--vocabulary-sha256", required=True)
    args = parser.parse_args()

    lock = json.loads(LOCK.read_text())
    sealed_signers, used_members = set(), set()
    for entry in lock["manifests"]:
        for row in json.loads(Path(entry["file"]).read_text()):
            used_members.add(row.get("archive_member"))
            if entry["role"] == "sealed-holdout":
                sealed_signers.add(row.get("source_participant_id") or row["participant_id"].replace("popsign-", ""))

    labels = json.loads(Path("public/models/asl2000-tgcn/labels.json").read_text())
    installed = {normalise(label): label for label in labels}
    for word in ("HELLO", "THANK YOU", "PLEASE", "SORRY", "YES", "NO", "I LOVE YOU"):
        installed.setdefault(normalise(word), word)

    # Archive URLs follow the pattern of the frozen manifests: <split>/<sign>.tar.
    plan = [(sign, args.target_signers) for sign in TARGETS] + [(sign, args.other_signers) for sign in OTHER_SIGNS]
    others, missing = [], []

    rows, skipped_sealed = [], 0
    for sign, wanted in plan:
        if sign not in TARGETS and len(others) >= args.other_signs:
            break
        url = f"{BASE}/{args.split}/{sign}.tar"
        chosen: dict[str, tuple[str, int, int]] = {}
        try:
            exists = len(get(url, 0, 512)) == 512
        except FileNotFoundError:
            exists = False
        if not exists:
            if sign in TARGETS:
                raise SystemExit(f"Target archive missing: {url}")
            missing.append(sign)
            continue
        if sign not in TARGETS:
            others.append(sign)
        for name, offset, size in members(url, args.max_headers):
            if not name.endswith(".mp4") or name in used_members:
                continue
            signer = Path(name).name.split("-")[0]
            if signer in sealed_signers:
                skipped_sealed += 1
                continue
            chosen.setdefault(signer, (name, offset, size))
            if len(chosen) >= wanted:
                break
        for signer, (name, offset, size) in chosen.items():
            data = get(url, offset, size)
            if data[4:8] != b"ftyp":
                continue
            path = Path("evaluation/videos/popsign-explore") / f"{sign}-{signer}.mp4"
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
            target = TARGETS.get(sign)
            label = target or installed.get(normalise(sign))
            row = {"trial_id": f"explore-{sign}-{signer}", "participant_id": f"popsign-{signer}", "source_participant_id": signer,
                   "language": "asl", "file": str(path), "recording_sha256": hashlib.sha256(data).hexdigest(),
                   "evaluation_split": "development", "source": url, "archive_member": name, "archive_offset": offset, "bytes": size,
                   "license": "CC BY 4.0", "source_split": f"PopSign ASL v1.0 game/{args.split}", "recording_group": name.removesuffix(".mp4"),
                   "annotation_review": "publisher label; no independent fluent-signer review", "cohort_group": "target" if target else "other-sign"}
            if label:
                row.update({"trial_type": "sign", "expected_gloss": label})
            else:
                row.update({"trial_type": "unknown_sign", "expected_gloss": None, "oov_gloss": sign, "vocabulary_sha256": args.vocabulary_sha256})
            rows.append(row)
        print(json.dumps({"sign": sign, "clips": len(chosen)}), flush=True)

    if not rows:
        raise SystemExit("Empty cohort")
    args.manifest.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(rows, indent=1) + "\n"
    args.manifest.write_text(text)
    extended = {**lock, "manifests": lock["manifests"] + [{"file": str(args.manifest), "role": "development",
                "sha256": hashlib.sha256(text.encode()).hexdigest(), "recordings": len(rows)}],
                "note": lock.get("note", "") + " Extended in CI with an exploratory PopSign game/test development cohort; original cohorts unchanged."}
    args.lock.write_text(json.dumps(extended, indent=1) + "\n")
    print(json.dumps({"split": args.split, "clips": len(rows), "targets": sum(row["cohort_group"] == "target" for row in rows),
                      "other_sign_clips": sum(row["cohort_group"] == "other-sign" for row in rows), "other_signs": others, "other_signs_not_published": missing,
                      "signers": len({row["participant_id"] for row in rows}), "sealed_signer_clips_skipped": skipped_sealed,
                      "manifest_sha256": hashlib.sha256(text.encode()).hexdigest()}))


if __name__ == "__main__":
    main()
