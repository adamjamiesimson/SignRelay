"""Fetch six new development-only PopSign v1 clips for the V2 open-set test."""
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "training"))
from import_popsign_development import DERIVED, archived_recordings, sample, signer_key

# Freeze the proposed confusions before examining any V2 outputs: two near-face
# movements and a chest-level movement. The official game/test clips are CC BY 4.0.
PLAN = ("mom", "thirsty", "hungry")


def main():
    target = Path("evaluation/derived/v2-native/open-set-hard-negatives.json")
    if target.exists():
        raise SystemExit(f"The local sample is already frozen: {target}")
    signers, hashes, members = archived_recordings()
    for split in ("train", "val"):
        for row in json.loads((DERIVED / f"{split}.json").read_text(encoding="utf-8")):
            signers.add(signer_key(row["participant_id"]))
            hashes.add(row["recording_sha256"])
            members.add(row["archive_member"])
    with ThreadPoolExecutor(max_workers=3) as pool:
        jobs = [pool.submit(sample, "test", gloss, 2, 1, signers, hashes, members) for gloss in PLAN]
        rows = [row for job in jobs for row in job.result()]
    if len(rows) != len(PLAN) * 2 or len({row["recording_sha256"] for row in rows}) != len(rows):
        raise ValueError("Expected two distinct clips per hard-negative gloss")
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("x", encoding="utf-8") as handle:
        json.dump(rows, handle, indent=2)
        handle.write("\n")


if __name__ == "__main__":
    main()
