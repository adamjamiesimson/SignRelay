"""Validate complete landmark shards before importing the training stack."""
import argparse
import hashlib
import json
from pathlib import Path
import re

import numpy as np


def validate(directory: Path, train_shards=10, test_shards=5):
    expected = {f"{split}-{i:02d}.npz" for split, count in (("train", train_shards), ("test", test_shards)) for i in range(count)}
    found = {p.name for p in directory.glob("*.npz")}
    if expected != found:
        raise ValueError(f"Landmark artifacts incomplete: missing={sorted(expected - found)}, unexpected={sorted(found - expected)}; extraction must succeed before training")
    clips = 0
    for name in sorted(expected):
        path = directory / name
        checksum = path.with_suffix(".sha256")
        if not checksum.is_file() or checksum.read_text(encoding="ascii").strip() != hashlib.sha256(path.read_bytes()).hexdigest():
            raise ValueError(f"Missing or mismatched landmark SHA-256: {name}")
        with np.load(path, allow_pickle=False) as data:
            pose, hands = data["pose"], data["hands"]
            entries = json.loads(str(data["index"]))
            if (pose.ndim != 3 or pose.shape[1:] != (33, 3) or hands.shape != (len(pose), 2, 21, 2)
                    or not len(pose) or not entries or np.isinf(pose).any() or np.isinf(hands).any()):
                raise ValueError(f"Empty or invalid landmark arrays: {name}")
            offset = 0
            for entry in entries:
                if (entry["offset"] != offset or type(entry["frames"]) is not int or entry["frames"] <= 0
                        or not entry.get("sign") or not entry.get("signer")
                        or entry.get("license") != "CC BY 4.0"
                        or not re.fullmatch(r"[0-9a-f]{64}", entry.get("recording_sha256", ""))):
                    raise ValueError(f"Invalid landmark index or provenance: {name}")
                offset += entry["frames"]
            if offset != len(pose):
                raise ValueError(f"Landmark frame spans do not match arrays: {name}")
            clips += len(entries)
    return {"shards": len(expected), "clips": clips}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    args = parser.parse_args()
    try:
        print(json.dumps(validate(args.directory)))
    except (ValueError, OSError, KeyError) as error:
        parser.exit(1, f"Training blocked: {error}\n")
