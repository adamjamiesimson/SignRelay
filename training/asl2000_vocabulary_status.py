"""Derive per-sign ASL-2000 availability from committed evaluation reports.

Nothing here is hand-picked: a word's status follows mechanically from the
derived reports of a diagnostics run (docs/evaluation/asl2000-sprint8/runs/).

- installed:    a model label. Says nothing about recognition.
- experimental: at least one correct, gate-accepted recognition of this word on
                a clip from a signer the model never saw, through the production
                input (end to end in the browser worker, or the isolated
                evaluator on MediaPipe landmarks). Wrong outputs are reported
                alongside.
- validated:    end to end in the production browser worker, on clips from
                at least VALIDATION["min_signers"] unseen signers: correct
                confirmation on at least VALIDATION["min_correct_rate"] of at
                least VALIDATION["min_clips"] clips, at most
                VALIDATION["max_wrong_on_own_clips"] wrong confirmation, the
                word confirmed wrongly on at most
                VALIDATION["max_false_label_rate"] of every other evaluated clip
                (other words and out-of-vocabulary signs), and median model
                latency within VALIDATION["max_median_model_ms"].

Starter-rule words (HELLO, THANK YOU, PLEASE, SORRY, YES, NO) and signer-taught
personal signs are separate recognition routes and are reported separately.
"""

from __future__ import annotations

import argparse
import gzip
import json
import statistics
from collections import defaultdict
from pathlib import Path

VALIDATION = {"min_signers": 3, "min_clips": 5, "min_correct_rate": 0.8, "max_wrong_on_own_clips": 1,
              "max_false_label_rate": 0.01, "max_median_model_ms": 1000}


def read_jsonl(path: Path) -> list[dict]:
    if not path.exists():
        return []
    opener = gzip.open if path.suffix == ".gz" else open
    with opener(path, "rt", encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("run", type=Path, help="docs/evaluation/asl2000-sprint8/runs/<id>")
    parser.add_argument("--labels", type=Path, default=Path("public/models/asl2000-tgcn/labels.json"))
    parser.add_argument("--production-variant", required=True, help="Evaluator variant equal to production ASL2000_INPUT")
    parser.add_argument("--worker", default="candidate")
    parser.add_argument("--output", type=Path, default=Path("public/models/asl2000-tgcn/vocabulary-status.json"))
    args = parser.parse_args()
    labels = json.loads(args.labels.read_text(encoding="utf-8"))
    label_set = set(labels)

    offline = defaultdict(lambda: {"clips": 0, "accepted_correct": 0, "signers": set()})
    for name in ("condition-b.records.jsonl.gz", "condition-p.records.jsonl.gz"):
        for record in read_jsonl(args.run / name):
            if record["condition"] not in (f"B-mediapipe-{args.production_variant}", f"P-mediapipe-{args.production_variant}"):
                continue
            if record.get("target") is None:
                continue
            entry = offline[record["gloss"]]
            entry["clips"] += 1
            entry["signers"].add(record.get("signer") or record["video_id"])
            entry["accepted_correct"] += int(record["accepted"] and record["rank"] == 1)

    clips = [row for row in read_jsonl(args.run / "condition-c.clips.jsonl.gz") if row["worker"] == args.worker and not row["error"]]
    latencies = [ms for row in clips for ms in row["model_ms"]]
    median_ms = statistics.median(latencies) if latencies else None
    e2e = defaultdict(lambda: {"clips": 0, "correct": 0, "wrong": 0, "signers": set()})
    false_label = defaultdict(int)
    for row in clips:
        confirmed = [c["gloss"] for c in row["confirmations"] if c["source"] == "model"]
        if row["gloss"] in label_set:
            entry = e2e[row["gloss"]]
            entry["clips"] += 1
            entry["signers"].add(row["signer"] or row["id"])
            entry["correct"] += int(row["gloss"] in confirmed)
            entry["wrong"] += sum(1 for gloss in confirmed if gloss != row["gloss"])
        for gloss in set(confirmed):
            if gloss != row["gloss"]:
                false_label[gloss] += 1

    experimental, validated = [], []
    for gloss in labels:
        o, e = offline.get(gloss), e2e.get(gloss)
        if not ((o and o["accepted_correct"]) or (e and e["correct"])):
            continue
        other_clips = len(clips) - (e["clips"] if e else 0)
        row = {"gloss": gloss,
               "endToEnd": {"clips": e["clips"], "correct": e["correct"], "wrong": e["wrong"], "signers": len(e["signers"])} if e else None,
               "isolated": {"clips": o["clips"], "acceptedCorrect": o["accepted_correct"], "signers": len(o["signers"])} if o else None,
               "falseLabelRate": round(false_label[gloss] / other_clips, 4) if other_clips else None}
        experimental.append(row)
        if (e and len(e["signers"]) >= VALIDATION["min_signers"] and e["clips"] >= VALIDATION["min_clips"]
                and e["correct"] / e["clips"] >= VALIDATION["min_correct_rate"]
                and e["wrong"] <= VALIDATION["max_wrong_on_own_clips"]
                and other_clips and false_label[gloss] / other_clips <= VALIDATION["max_false_label_rate"]
                and median_ms is not None and median_ms <= VALIDATION["max_median_model_ms"]):
            validated.append(gloss)

    status = {
        "schema": 1,
        "source": str(args.run),
        "productionInput": args.production_variant,
        "criteria": {"experimental": "At least one correct, gate-accepted recognition of the word on a clip from an unseen signer through the production input.",
                     "validated": VALIDATION},
        "counts": {"installed": len(labels), "evaluatedWords": len(set(offline) | set(e2e)), "experimental": len(experimental),
                   "validated": len(validated), "endToEndClips": len(clips), "medianModelMs": median_ms},
        "validated": validated,
        "experimental": experimental,
    }
    args.output.write_text(json.dumps(status, indent=1) + "\n", encoding="utf-8")
    print(json.dumps(status["counts"]))


if __name__ == "__main__":
    main()
