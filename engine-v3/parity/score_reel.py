"""Score a Chrome camera replay against the reel's ground truth.

  python score_reel.py <replay.json> [--offset-ms 0]
Each recognition event's segment [start, end] (ms since camera playback start) is matched to the
ground-truth interval it overlaps most. Reports per-interval outcome (correct / wrong / unknown /
uncertain / missed), events falling entirely in the neutral gaps (spurious), duplicate events within one
interval, and whether the accepted-label sequence equals the expected supported-sign sequence exactly.
"""
import json, sys


def score(rep, offset_ms=0.0):
    truth = rep["truth"]["segments"]; t0 = rep.get("t0") or 0
    evs = [e for e in rep["events"] if e.get("segment")]
    base = min((e["segment"][0] for e in evs), default=0) if not t0 else t0
    per = [{"label": s["label"], "events": []} for s in truth]
    spurious = []
    for e in evs:
        a, b = (e["segment"][0] - rep["camera_t0"] + offset_ms) / 1000, (e["segment"][1] - rep["camera_t0"] + offset_ms) / 1000
        best, ov = None, 0.0
        for i, s in enumerate(truth):
            o = min(b, s["end"] + 0.4) - max(a, s["start"] - 0.4)
            if o > ov: best, ov = i, o
        (per[best]["events"] if best is not None else spurious).append(e)
    out = []
    for p in per:
        acc = [e for e in p["events"] if e["status"] == "accepted"]
        if not p["events"]: o = "missed"
        elif acc: o = "correct" if acc[0]["label"] == p["label"] else ("false-accept" if p["label"].startswith("__") else "wrong")
        else: o = "rejected" if p["label"].startswith("__") else p["events"][0]["status"]
        out.append({"label": p["label"], "outcome": o, "n_events": len(p["events"]), "n_accepted": len(acc),
                    "accepted": [e["label"] for e in acc]})
    expected = [p["label"] for p in out if not p["label"].startswith("__")]
    got = [e["label"] for e in sorted(evs, key=lambda e: e["segment"][0]) if e["status"] == "accepted"]
    summ = {"intervals": len(out), "supported": len(expected),
            "correct": sum(o["outcome"] == "correct" for o in out),
            "wrong": sum(o["outcome"] == "wrong" for o in out),
            "missed": sum(o["outcome"] == "missed" for o in out),
            "abstained_on_supported": sum(o["outcome"] in ("unknown", "uncertain", "no-sign") and not o["label"].startswith("__") for o in out),
            "unsupported_intervals": sum(o["label"].startswith("__") for o in out),
            "unsupported_false_accepts": sum(o["outcome"] == "false-accept" for o in out),
            "duplicate_accepts": sum(max(0, o["n_accepted"] - 1) for o in out),
            "spurious_events_in_gaps": len(spurious), "exact_sequence_match": got == expected,
            "expected_sequence": expected, "accepted_sequence": got}
    return {"summary": summ, "intervals": out}


if __name__ == "__main__":
    rep = json.load(open(sys.argv[1]))
    r = score(rep); print(json.dumps(r["summary"], indent=1))
    if len(sys.argv) > 2: json.dump(r, open(sys.argv[2], "w"), indent=1)
