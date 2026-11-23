#!/usr/bin/env python3
"""Summarize integrated replay JSON files written by run-engine-comparison.mjs.

usage: summarize-replays.py result.json [...]   (prints one row per file and a total)
"""
import json
import sys
from collections import Counter


def summarize(path):
    data = json.load(open(path))
    counts = Counter()
    for interval in data["intervals"]:
        counts[interval["outcome"]] += 1
        counts["duplicates"] += interval.get("duplicateAccepts", 0)
    frames = data["tracking"]["analysedOrForwardedFrames"]
    hands = data["tracking"]["handFrames"]
    return {
        "file": path.split("/")[-1], "correct": counts["correct"], "wrong": counts["wrong"],
        "abstained": counts["abstained"], "unknown_false_accepts": counts["false-accept"],
        "unknown_rejected": counts["rejected"], "gap_accepts": data["idleAccepts"], "duplicates": counts["duplicates"],
        "errors": len(data["runtimeErrors"]) + sum(1 for e in data.get("browserErrors") or [] if e.get("error") != "net::ERR_ABORTED"),
        "transcript": data["transcriptEntries"], "spoken": len(data["spoken"]),
        "fps": round(data["tracking"]["analysedOrForwardedFps"], 2), "hand_rate": round(hands / max(1, frames), 3),
        "revision": (data.get("applicationRevision") or "")[:9],
    }


if __name__ == "__main__":
    rows = [summarize(path) for path in sys.argv[1:]]
    keys = list(rows[0])
    print("\t".join(keys))
    for row in rows:
        print("\t".join(str(row[key]) for key in keys))
    total = {key: sum(row[key] for row in rows) for key in keys[1:11]}
    print("TOTAL\t" + "\t".join(str(total[key]) for key in keys[1:11]))
