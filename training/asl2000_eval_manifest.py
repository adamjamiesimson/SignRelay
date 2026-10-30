"""Freeze the ASL-2000 evaluation sample before any result is seen.

Selection uses only the publisher's WLASL_v0.3.json, a fixed seed and fixed
rules, so it cannot depend on which signs happen to work:

- everyday: every official test instance of the 30 everyday signs named in the
  Sprint 8 brief (all of them are WLASL2000 labels).
- tiers: 25 glosses drawn at random from each WLASL frequency tier (ranks
  1-100, 101-300, 301-1000, 1001-2000), excluding the everyday and starter
  signs, with every official test instance of each.
- random: 300 official test instances drawn uniformly from the whole test split.

Instances are identified by WLASL video_id. Source videos are listed only so a
C-UDA-compliant runner can fetch direct (non-YouTube) clips for conditions B/C.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import random
from pathlib import Path

SEED = 20261030
EVERYDAY = ("BOOK WATER EAT DRINK COMPUTER SCHOOL FAMILY MOTHER FATHER HELP DOCTOR WORK WALK GO COME FRIEND "
            "HAPPY SAD WHAT WHERE WHO WHEN WHY GOOD BAD HOT COLD NEED WANT UNDERSTAND").split()
STARTER = ["HELLO", "THANK YOU", "PLEASE", "SORRY", "YES", "NO"]
TIERS = [(0, 100), (100, 300), (300, 1000), (1000, 2000)]


def direct_source(url: str) -> bool:
    host = url.split("/")[2].lower() if "://" in url else ""
    return bool(host) and "youtube" not in host and "youtu.be" not in host


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("index", type=Path, help="Publisher WLASL_v0.3.json")
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    raw = args.index.read_bytes()
    entries = json.loads(raw)
    if len(entries) != 2000:
        raise SystemExit("Expected the 2000-gloss WLASL index")
    rank = {entry["gloss"].upper(): index for index, entry in enumerate(entries)}
    by_gloss = {entry["gloss"].upper(): entry for entry in entries}
    missing = [gloss for gloss in EVERYDAY if gloss not in by_gloss]
    if missing:
        raise SystemExit(f"Everyday signs missing from WLASL2000: {missing}")

    def tests(gloss: str) -> list[dict]:
        return [
            {
                "video_id": instance["video_id"], "gloss": gloss, "wlasl_rank": rank[gloss] + 1,
                "signer_id": instance["signer_id"], "frame_start": instance["frame_start"],
                "frame_end": instance["frame_end"], "fps": instance.get("fps"),
                "url": instance["url"], "direct_source": direct_source(instance["url"]),
            }
            for instance in by_gloss[gloss]["instances"] if instance["split"] == "test"
        ]

    rng = random.Random(SEED)
    excluded = set(EVERYDAY) | set(STARTER)
    tiers = []
    for low, high in TIERS:
        pool = [entry["gloss"].upper() for entry in entries[low:high] if entry["gloss"].upper() not in excluded]
        chosen = sorted(rng.sample(pool, 25), key=lambda gloss: rank[gloss])
        tiers.append({"ranks": [low + 1, high], "glosses": chosen})
    all_tests = [item for entry in entries for item in tests(entry["gloss"].upper())]
    random_instances = sorted(rng.sample(all_tests, 300), key=lambda item: (item["wlasl_rank"], item["video_id"]))

    manifest = {
        "purpose": "Frozen Sprint 8 ASL-2000 evaluation sample. Selected before any result was seen.",
        "seed": SEED,
        "source_index": {"file": "WLASL_v0.3.json", "sha256": hashlib.sha256(raw).hexdigest(),
                         "url": "https://raw.githubusercontent.com/dxli94/WLASL/master/start_kit/WLASL_v0.3.json"},
        "license": "WLASL C-UDA 1.0: academic and computational use only. Raw videos/keypoints are never committed or deployed.",
        "rules": __doc__.strip(),
        "starter_signs_excluded_from_non_starter_sets": STARTER,
        "groups": {
            "everyday": [item for gloss in EVERYDAY for item in tests(gloss)],
            "tiers": [{**tier, "instances": [item for gloss in tier["glosses"] for item in tests(gloss)]} for tier in tiers],
            "random": random_instances,
        },
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(manifest, indent=1) + "\n", encoding="utf-8")
    everyday = manifest["groups"]["everyday"]
    tier_items = [item for tier in manifest["groups"]["tiers"] for item in tier["instances"]]
    print(json.dumps({
        "everyday_instances": len(everyday), "everyday_direct": sum(item["direct_source"] for item in everyday),
        "tier_glosses": sum(len(tier["glosses"]) for tier in tiers), "tier_instances": len(tier_items),
        "tier_direct": sum(item["direct_source"] for item in tier_items),
        "random_instances": len(random_instances), "random_direct": sum(item["direct_source"] for item in random_instances),
    }))


if __name__ == "__main__":
    main()
