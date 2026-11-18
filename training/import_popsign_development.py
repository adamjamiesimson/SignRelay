"""Acquire a bounded, signer-aware sample from the official PopSign v1 archives."""

import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path, PurePosixPath
import re

from build_popsign_exploration import BASE, LOCK, TARGETS, get, members


# Nearby-face, handshape and trajectory confusions chosen before scoring.
NEGATIVES = ("after", "cat", "fish", "horse", "hot", "nose", "water")
DATASET = "https://signdata.cc.gatech.edu/view/datasets/popsign_v1_0/"
MEDIA = Path("evaluation/videos/popsign-rebirth-v1")
DERIVED = Path("evaluation/derived/popsign-rebirth-v1")


def signer_key(value):
    return re.sub(r"^(?:popsign-)?(?:gtsignstudy)?", "", value.strip().lower())


def archived_recordings():
    sealed_signers, sealed_hashes, existing_groups = set(), set(), set()
    for entry in json.loads(LOCK.read_text(encoding="utf-8"))["manifests"]:
        for row in json.loads(Path(entry["file"]).read_text(encoding="utf-8")):
            existing_groups.add(row["archive_member"])
            if entry["role"] == "sealed-holdout":
                sealed_signers.add(signer_key(row["participant_id"]))
                sealed_hashes.add(row["recording_sha256"])
    return sealed_signers, sealed_hashes, existing_groups


def clip_bytes(url, start, size):
    try:
        return get(url, start, size)
    except ValueError as error:
        if str(error) != "Short range read":
            raise
    # Some servers close long range reads early. Retry with bounded ranges.
    block = 1024 * 1024
    return b"".join(get(url, start + offset, min(block, size - offset)) for offset in range(0, size, block))


def sample(split, sign, wanted, per_signer, forbidden, sealed_hashes, existing_groups):
    url = f"{BASE}/{split}/{sign}.tar"
    seen = Counter()
    rows = []
    for member, start, size in members(url, max(80, wanted * 5)):
        name = PurePosixPath(member).name
        signer = signer_key(name.split("-", 1)[0])
        if not name.endswith(".mp4") or not re.fullmatch(r"4[a-z]\.\d+", signer):
            continue
        if signer in forbidden or seen[signer] >= per_signer or member in existing_groups:
            continue
        data = clip_bytes(url, start, size)
        digest = hashlib.sha256(data).hexdigest()
        if digest in sealed_hashes:
            raise ValueError("Archive member duplicates a sealed recording")
        if data[4:8] != b"ftyp":
            raise ValueError(f"Archive member is not MP4: {split}/{sign} @ {start}")
        path = MEDIA / split / f"{digest}.mp4"
        path.parent.mkdir(parents=True, exist_ok=True)
        if path.exists():
            if hashlib.sha256(path.read_bytes()).hexdigest() != digest:
                raise ValueError(f"Cached video differs: {path}")
        else:
            path.write_bytes(data)
        rows.append({
            "trial_id": f"rebirth-{split}-{sign}-{digest[:16]}",
            "participant_id": f"popsign-{signer}",
            "language": "asl",
            "file": path.as_posix(),
            "recording_sha256": digest,
            "recording_group": name.removesuffix(".mp4"),
            "archive_member": member,
            "archive_offset": start,
            "bytes": size,
            "source": url,
            "dataset": DATASET,
            "license": "CC BY 4.0",
            "source_split": f"PopSign ASL v1.0 game/{split}",
            "evaluation_split": "development",
            "trial_type": "sign",
            "expected_gloss": TARGETS.get(sign, sign.upper()),
            "role_in_candidate": "target" if sign in TARGETS else "unsupported",
            "annotation_review": "publisher label; no independent fluent-signer review",
        })
        seen[signer] += 1
        if len(rows) == wanted:
            break
    if not rows:
        raise ValueError(f"No eligible recordings for {split}/{sign}")
    print(json.dumps({"split": split, "sign": sign, "recordings": len(rows), "signers": len(seen)}), flush=True)
    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("split", choices=["train", "val"])
    parser.add_argument("--targets", type=int, default=24, help="maximum videos per target gloss")
    parser.add_argument("--negatives", type=int, default=6, help="maximum videos per unsupported gloss")
    parser.add_argument("--takes-per-signer", type=int, default=2)
    args = parser.parse_args()
    if min(args.targets, args.negatives, args.takes_per_signer) < 1:
        parser.error("counts must be positive")
    DERIVED.mkdir(parents=True, exist_ok=True)
    manifest = DERIVED / f"{args.split}.json"
    if manifest.exists():
        parser.error(f"manifest already frozen: {manifest}")
    sealed, hashes, groups = archived_recordings()
    # Training and publisher validation never share a signer even if the
    # source contains aliases or later changes its split assignment.
    other_split = "val" if args.split == "train" else "train"
    other = DERIVED / f"{other_split}.json"
    related = json.loads(other.read_text(encoding="utf-8")) if other.exists() else []
    forbidden = sealed | {signer_key(row["participant_id"]) for row in related}
    jobs = [(args.split, sign, args.targets if sign in TARGETS else args.negatives,
             args.takes_per_signer, forbidden, hashes, groups) for sign in (*TARGETS, *NEGATIVES)]
    rows = []
    with ThreadPoolExecutor(max_workers=4) as pool:
        tasks = [(job[1], pool.submit(sample, *job)) for job in jobs]
        for sign, task in tasks:
            try:
                rows.extend(task.result())
            except FileNotFoundError:
                if sign in TARGETS:
                    raise
                print(json.dumps({"split": args.split, "sign": sign, "status": "archive unavailable"}), flush=True)
    for key in ("recording_sha256", "recording_group", "trial_id"):
        values = [row[key] for row in [*related, *rows]]
        if len(values) != len(set(values)):
            raise ValueError(f"Duplicate {key}")
    with manifest.open("x", encoding="utf-8", newline="\n") as output:
        json.dump(rows, output, indent=2)
        output.write("\n")
    print(json.dumps({"manifest": manifest.as_posix(), "sha256": hashlib.sha256(manifest.read_bytes()).hexdigest()}))


if __name__ == "__main__":
    main()
