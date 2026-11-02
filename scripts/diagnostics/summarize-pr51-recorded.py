"""Aggregate the PR 51 recorded-RGB ledgers (pr51-recorded-validation.yml).

Input: a directory holding the downloaded artifact JSON ledgers (local only;
they contain per-case predictions). Output: an aggregate with no recording
identifiers, references, predictions or landmarks.

Definitions match the PR #49/#50 reports: CER = total Levenshtein edits /
total reference characters including internal spaces; predictions are trimmed
at the boundaries only. A candidate is any displayed non-empty text; an
abstention is a quality or model abstention; technical failures are separate.

usage: python scripts/diagnostics/summarize-pr51-recorded.py <ledger-dir> <out.json>
"""
import json, statistics, sys
from collections import defaultdict
from pathlib import Path

directory, out = Path(sys.argv[1]), Path(sys.argv[2])
STAGES = ["schedule", "observations", "features", "logits", "output"]

def lev(a, b):
    row = list(range(len(b) + 1))
    for i in range(1, len(a) + 1):
        prev, row[0] = row[0], i
        for j in range(1, len(b) + 1):
            prev, row[j] = row[j], min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] != b[j - 1]))
    return row[len(b)]

def quantile(values, q):
    v = sorted(values)
    return round(v[min(len(v) - 1, int(q * len(v)))], 1) if v else None

def outcome(row):
    if row["technicalFailure"]:
        return {"technical": True}
    r = row["result"]
    reference = (r.get("reference") if r.get("reference") is not None else r.get("source", {}).get("reference")) or ""
    text = (r.get("prediction") or "").strip()
    telemetry = r.get("captureTelemetry") or {}
    stages = {**(telemetry.get("fingerprints") or {}), **{k: v for k, v in (r.get("resultFingerprints") or {}).items() if k != "schedule" and k != "observations"}}
    return {"technical": False, "reference": reference.strip().upper(), "text": text, "candidate": bool(text),
            "status": r.get("status"), "input": r.get("inputSha256"), "fps": r.get("observedCaptureFps"),
            "gap": r.get("maxFrameGapMs"), "latency": r.get("finishToDomCandidateMs"), "worker": r.get("finishToWorkerResultMs"),
            "inference": r.get("inferenceMs"), "frames": r.get("frames") or r.get("observedFrames"), "stages": stages}

ledgers = defaultdict(dict)  # (catalog, variant) -> repeat -> {id: outcome}
for path in sorted(directory.rglob("*.json")):
    data = json.loads(path.read_text())
    if "cases" not in data or "variant" not in data:
        continue
    catalog = data["catalog"]
    repeat = str(data["repeat"])
    assert data["modelSha256"] == "34c823aef5eaa3e4b74c564138a1a224f8c9a8426e0f69a331d5c01fbf53008b"
    ledgers[(catalog, data["variant"])][repeat] = {"source": data["sourceSha"], "complete": data["complete"], "planned": data["planned"],
                                                  "rows": {c["id"]: outcome(c) for c in data["cases"]}}

def summarize(catalog, variant):
    runs = ledgers.get((catalog, variant), {})
    rows = [o for run in runs.values() for o in run["rows"].values()]
    ok = [o for o in rows if not o["technical"]]
    positive = catalog != "negative"
    s = {"runs": len(runs), "sources": sorted({run["source"] for run in runs.values()}), "planned": sum(run["planned"] for run in runs.values()),
         "captures": len(rows), "technicalFailures": len(rows) - len(ok),
         "candidates": sum(o["candidate"] for o in ok), "abstentions": sum(not o["candidate"] for o in ok),
         "qualityAbstentions": sum(o["status"] == "abstained-quality" for o in ok), "modelAbstentions": sum(o["status"] == "abstained-model" for o in ok),
         "finishToCandidateMs": {"median": quantile([o["latency"] for o in ok if o["latency"] is not None], .5), "p95": quantile([o["latency"] for o in ok if o["latency"] is not None], .95)},
         "observedCaptureHzMedian": quantile([o["fps"] for o in ok if o["fps"]], .5),
         "maxFrameGapMsMedian": quantile([o["gap"] for o in ok if o["gap"] is not None], .5)}
    if positive:
        s["exact"] = sum(o["text"] == o["reference"] for o in ok)
        s["characterEdits"] = sum(lev(o["text"], o["reference"]) for o in ok)
        s["referenceCharacters"] = sum(len(o["reference"]) for o in ok)
        s["CER"] = round(s["characterEdits"] / s["referenceCharacters"], 4) if s["referenceCharacters"] else None
    else:
        s["falseCandidates"] = s["candidates"]
    # Consistency: same displayed text (abstention = "") in every repeat of a case.
    ids = set().union(*[set(run["rows"]) for run in runs.values()]) if runs else set()
    if len(runs) > 1:
        same, divergence = 0, defaultdict(int)
        for i in ids:
            outs = [run["rows"].get(i) for run in runs.values()]
            if any(o is None or o["technical"] for o in outs):
                divergence["technical"] += 1; continue
            if len({o["text"] for o in outs}) == 1: same += 1
            # Earliest stage at which any repeat differs (candidate rows carry fingerprints).
            stage = next((k for k in STAGES if all(k in o["stages"] for o in outs) and len({o["stages"][k] for o in outs}) > 1), None)
            if stage is None and len({o["input"] for o in outs if o["input"]}) > 1: stage = "features"
            divergence[stage or "none"] += 1
        s["consistentCases"], s["casesCompared"] = same, len(ids)
        s["repeatDivergenceStage"] = dict(divergence)
    return s

result = {"kind": "Exposed recorded RGB regressions; same runner, alternating PR #50 baseline (d8cfefc) and PR #51 candidate per case. Not a fresh final cohort and not physical-webcam evidence.",
          "metrics": "CER = Levenshtein edits / reference characters (internal spaces included); candidates are displayed uncertain texts requiring confirmation", "catalogs": {}}
for catalog in ["positive", "negative", "rare-original", "rare-mirrored"]:
    result["catalogs"][catalog] = {v: summarize(catalog, v) for v in ["baseline", "candidate"]}
    # Paired: identical captured tensors between implementations for the same case and repeat.
    b, c = ledgers.get((catalog, "baseline"), {}), ledgers.get((catalog, "candidate"), {})
    pairs = identical = identicalSameText = 0
    for repeat in set(b) & set(c):
        for i, o in b[repeat]["rows"].items():
            p = c[repeat]["rows"].get(i)
            if not p or o["technical"] or p["technical"] or not o["input"] or not p["input"]: continue
            pairs += 1
            if o["input"] == p["input"]:
                identical += 1; identicalSameText += o["text"] == p["text"]
    result["catalogs"][catalog]["paired"] = {"comparedCaptures": pairs, "identicalCapturedTensors": identical, "identicalTensorsWithSameText": identicalSameText}
    # Per-case table keyed by catalog position only (no identifiers or text).
    order = sorted(set().union(*[set(run["rows"]) for run in list(b.values()) + list(c.values())])) if (b or c) else []
    def brief(o):
        if o is None: return None
        if o["technical"]: return {"technical": True}
        d = {"status": o["status"], "candidate": o["candidate"], "frames": o["frames"], "hz": o["fps"]}
        if catalog != "negative": d.update(exact=o["text"] == o["reference"], edits=lev(o["text"], o["reference"]), chars=len(o["reference"]))
        return d
    result["catalogs"][catalog]["cases"] = [{"case": k, "repeat": r, "baseline": brief(b.get(r, {}).get("rows", {}).get(i)), "candidate": brief(c.get(r, {}).get("rows", {}).get(i)),
        "sameTensor": bool(b.get(r) and c.get(r) and b[r]["rows"].get(i, {}).get("input") and b[r]["rows"][i].get("input") == c[r]["rows"].get(i, {}).get("input"))}
        for k, i in enumerate(order) for r in sorted(set(b) | set(c))]
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps(result, indent=1))
print(json.dumps(result, indent=1))
