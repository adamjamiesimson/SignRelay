"""Clip sets for the starter-reliability evaluation (C-UDA; clips stay on the runner).

  exposed-negative   the first 120 direct clips of the frozen Sprint 8 sample,
                     exactly the F1 recorded-RGB set (already seen; development only)
  heldout-negative   the next direct clips of the same frozen order, never replayed
                     before; starter glosses excluded
  dev-positive       every direct WLASL instance of a starter gloss in the train split
  heldout-positive   every direct WLASL instance of a starter gloss in val/test

Rules are tuned only on the dev sets; held-out sets are reported, never tuned on.
Each clip records WLASL's own signer_id (on the runner only) so research
experiments can use signer-disjoint folds.
usage: PYTHONPATH=training python scripts/asl2000-eval/starter-sets.py INDEX.json VIDEOS OUT.json [HELDOUT_NEG]
"""
import hashlib
import json
import sys
import time
from pathlib import Path

from asl2000_conditions import download, selected_instances  # noqa: E402

STARTER = {"hello", "no", "yes", "please", "sorry", "thank you"}
index_path, videos, out = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
heldout_negatives = int(sys.argv[4]) if len(sys.argv) > 4 else 150
sample = json.loads(Path("docs/evaluation/asl2000-sprint8/frozen-sample.json").read_text(encoding="utf-8"))
assert hashlib.sha256(index_path.read_bytes()).hexdigest() == sample["source_index"]["sha256"], "WLASL index differs from the frozen sample's"
entries = json.loads(index_path.read_text(encoding="utf-8"))
index = {inst["video_id"]: inst for entry in entries for inst in entry["instances"]}


def direct(url: str) -> bool:
    host = url.split("/")[2].lower() if "://" in url else ""
    return bool(host) and "youtube" not in host and "youtu.be" not in host


videos.mkdir(parents=True, exist_ok=True)
last, statuses, chosen = {}, {}, []


def fetch(vid: str, url: str) -> bool:
    host = url.split("/")[2]
    wait = 1.0 - (time.time() - last.get(host, 0))
    if wait > 0:
        time.sleep(wait)
    last[host] = time.time()
    status = download(url, videos / f"{vid}.video")
    statuses[status.split(":")[0]] = statuses.get(status.split(":")[0], 0) + 1
    return status in {"ok", "cached"}


order = {"everyday": 0}
seen, negatives = set(), []
for group, item in sorted(selected_instances(sample), key=lambda pair: order.get(pair[0], 1 if pair[0].startswith("tier") else 2)):
    vid, source = item["video_id"], index.get(item["video_id"])
    if vid in seen or not source or not item["direct_source"] or source["frame_start"] != 1 or source["frame_end"] != -1:
        continue
    seen.add(vid)
    negatives.append((group, item))
# The F1 set is the first 120 that downloaded, so walk the same order.
exposed = 0
for group, item in negatives:
    if exposed < 120:
        if fetch(item["video_id"], item["url"]):
            chosen.append({"id": item["video_id"], "file": str(videos / f"{item['video_id']}.video"), "gloss": item["gloss"], "set": "exposed-negative", "group": group,
                           "signer": str(index[item["video_id"]].get("signer_id"))})
            exposed += 1
        continue
    if item["gloss"].lower() in STARTER:
        continue
    if sum(1 for c in chosen if c["set"] == "heldout-negative") >= heldout_negatives:
        break
    if fetch(item["video_id"], item["url"]):
        chosen.append({"id": item["video_id"], "file": str(videos / f"{item['video_id']}.video"), "gloss": item["gloss"], "set": "heldout-negative", "group": group,
                       "signer": str(index[item["video_id"]].get("signer_id"))})

for entry in entries:
    if entry["gloss"].lower() not in STARTER:
        continue
    for inst in entry["instances"]:
        if not direct(inst["url"]) or inst["frame_start"] != 1 or inst["frame_end"] != -1 or inst["video_id"] in seen:
            continue
        seen.add(inst["video_id"])
        if fetch(inst["video_id"], inst["url"]):
            chosen.append({"id": inst["video_id"], "file": str(videos / f"{inst['video_id']}.video"), "gloss": entry["gloss"].upper(),
                           "set": "dev-positive" if inst["split"] == "train" else "heldout-positive", "group": inst["split"],
                           "signer": str(inst.get("signer_id"))})

out.write_text(json.dumps(chosen, indent=1), encoding="utf-8")
counts = {}
for c in chosen:
    counts[c["set"]] = counts.get(c["set"], 0) + 1
print(json.dumps({"clips": len(chosen), "sets": counts, "downloads": statuses,
                  "positives_by_gloss": {g: sum(1 for c in chosen if c["gloss"] == g) for g in sorted({c["gloss"] for c in chosen if c["set"].endswith("positive")})}}))
