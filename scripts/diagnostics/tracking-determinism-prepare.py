"""Licensed FSboard clips -> every decoded display frame (lossless PNG) for the
tracker determinism study. Same verified-source path as the recorded-camera
regressions (Kaggle googleai/fsboard v13, MD5 + SHA-256 checked). Frames and
the sample index stay under git-ignored work/ on the runner; never upload them.

The cases are the already-exposed regression catalog (10 positive) plus the
five frozen #49 Q/J/Z / returned-Left cases. No case is chosen from results.
"""
import gzip, hashlib, json, pathlib, sys
import cv2, kagglehub, numpy as np
sys.path.insert(0, "training/fingerspelling")
from prepare import metadata
sys.path.insert(0, "training/fingerspelling/upright")
from upright_video import frames as display_frames

RARE = ["164650016581817f52803ab7", "10ed939b4682a892fb626193", "47b36e3fa22f13b5bdb304f9", "032cf1f7a7b86bdec79412b9", "02f5e0ef7897ad962de7cca5"]
root = pathlib.Path("work/determinism"); (root / "frames").mkdir(parents=True, exist_ok=True)
positive = [{"id": "6befb92aee4dcad7bf6ed904", "role": "known-regression"}, {"id": "6cd1239964a94fcc9b8eaff0", "role": "known-regression"}]
positive += [{"id": r["id"], "role": r["role"]} for r in json.loads(pathlib.Path("docs/fingerspelling/evidence/upright-browser-fixture-index.json").read_text())]
cases = positive + [{"id": i, "role": "rare-regression"} for i in RARE]
assert len(cases) == 15 and len({c["id"] for c in cases}) == 15
sources = json.loads(pathlib.Path("docs/fingerspelling/evidence/fsboard-v13-provenance.json").read_text())["rows"]
sources += json.loads(gzip.decompress(pathlib.Path("docs/fingerspelling/evidence/upright-provenance.json.gz").read_bytes()))["rows"]
meta = {}
samples = []
for index, case in enumerate(cases):
    source = next(r for r in sources if r["id"] == case["id"])
    split = source.get("sourceSplit", source.get("split"))
    meta.setdefault(split, {r["clipFilename"]: r for r in metadata(split)})
    record = meta[split][source["source"]]
    path = pathlib.Path(kagglehub.dataset_download("googleai/fsboard/versions/13", path="daun_v3/video_clips/daun_v3-" + split + "/" + source["source"]))
    blob = path.read_bytes()
    assert len(blob) == record["clipFileSize"] and hashlib.md5(blob, usedforsecurity=False).hexdigest() == record["clipFileMd5"]
    assert hashlib.sha256(blob).hexdigest() == source["rawSha256"]
    start = 1000 * (record["annotationStartTimeS"] - record["clipStartTimeS"])
    end = 1000 * (record["annotationEndTimeS"] - record["clipStartTimeS"])
    out = root / "frames" / str(index); out.mkdir(parents=True, exist_ok=True)
    rows, previous = [], -1.0
    for t, rgb, _info in display_frames(path):
        ms = t * 1000
        assert ms > previous; previous = ms
        if ms < start - 1000 or ms > end + 300:
            continue
        name = f"{len(rows)}.png"
        assert cv2.imwrite(str(out / name), cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR))
        rows.append({"ms": round(ms, 3), "png": f"/frames/{index}/{name}", "rgbSha256": hashlib.sha256(np.ascontiguousarray(rgb).tobytes()).hexdigest()})
    path.unlink()
    assert rows, "No decoded frames in the annotation window"
    reference = source.get("reference", source.get("phrase", record.get("phrase", ""))).upper()
    samples.append({"index": index, "role": case["role"], "rare": case["id"] in RARE, "reference": reference,
                    "annotationStartMs": start, "annotationEndMs": end, "width": int(rgb.shape[1]), "height": int(rgb.shape[0]),
                    "nativeFps": round((len(rows) - 1) * 1000 / (rows[-1]["ms"] - rows[0]["ms"]), 3), "frames": rows,
                    "rawSha256": source["rawSha256"]})
    print("DETERMINISM-SOURCE", index, case["role"], len(rows), "frames", flush=True)
(root / "samples.json").write_text(json.dumps(samples))
print("DETERMINISM-SAMPLES", len(samples), flush=True)
