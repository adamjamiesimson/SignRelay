"""Fetch the frozen Sprint 8 sample's direct (non-YouTube) WLASL clips for the
F1 before/after browser replay, using the same selection and download code as
condition B (training/asl2000_conditions.py) without its MediaPipe pass.

The WLASL index must match the hash the sample was frozen against. TLS is
verified by urllib's defaults; nothing here weakens it. Clips stay on the
runner (C-UDA 1.0: academic and computational use only) and are never
committed or uploaded.

usage: PYTHONPATH=training python scripts/asl2000-eval/f1-fetch-clips.py INDEX.json VIDEOS_DIR OUT_CLIPS.json [LIMIT]
"""
import hashlib
import json
import sys
import time
from pathlib import Path

from asl2000_conditions import download, selected_instances  # noqa: E402

index_path, videos, out = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
limit = int(sys.argv[4]) if len(sys.argv) > 4 else 120
sample = json.loads(Path("docs/evaluation/asl2000-sprint8/frozen-sample.json").read_text(encoding="utf-8"))
actual = hashlib.sha256(index_path.read_bytes()).hexdigest()
assert actual == sample["source_index"]["sha256"], "WLASL index differs from the one the sample was frozen against"
index = {inst["video_id"]: inst for entry in json.loads(index_path.read_text(encoding="utf-8")) for inst in entry["instances"]}
videos.mkdir(parents=True, exist_ok=True)
order = {"everyday": 0}
chosen, seen, statuses, last = [], set(), {}, {}
for group, item in sorted(selected_instances(sample), key=lambda pair: order.get(pair[0], 1 if pair[0].startswith("tier") else 2)):
    vid = item["video_id"]
    source = index.get(vid)
    if vid in seen or not source or not item["direct_source"] or source["frame_start"] != 1 or source["frame_end"] != -1:
        continue
    seen.add(vid)
    host = item["url"].split("/")[2]
    wait = 1.0 - (time.time() - last.get(host, 0))
    if wait > 0:
        time.sleep(wait)
    last[host] = time.time()
    path = videos / f"{vid}.video"
    status = download(item["url"], path)
    statuses[status.split(":")[0]] = statuses.get(status.split(":")[0], 0) + 1
    if status in {"ok", "cached"}:
        chosen.append({"id": vid, "file": str(path), "gloss": item["gloss"], "group": group})
    if len(chosen) >= limit:
        break
out.write_text(json.dumps(chosen, indent=1), encoding="utf-8")
print(json.dumps({"clips": len(chosen), "downloads": statuses, "groups": {g: sum(1 for c in chosen if c["group"] == g) for g in sorted({c["group"] for c in chosen})}}))
