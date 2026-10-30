"""Render a diagnostics run's committed reports as Markdown tables (verbatim numbers)."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def pct(value) -> str:
    return "—" if value is None else f"{100 * value:.1f}%"


def condition_table(summary: dict, conditions: list[str], group: str = "all-unique") -> str:
    rows = ["| condition | n | top-1 | top-5 | top-10 | median rank | gate accepted (correct / wrong) |", "|---|---|---|---|---|---|---|"]
    for condition in conditions:
        m = summary.get(condition, {}).get(group)
        if m and m.get("n"):
            rows.append(f"| {condition} | {m['n']} | {pct(m['top1'])} | {pct(m['top5'])} | {pct(m['top10'])} | {m['median_rank']} | "
                        f"{m['gate_accepted']} ({m['gate_accepted_correct']} / {m['gate_accepted_wrong']}) |")
    return "\n".join(rows)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("run", type=Path)
    args = parser.parse_args()
    for name in ("condition-a.json", "condition-b.json", "condition-p.json", "condition-c.json"):
        path = args.run / name
        if not path.exists():
            continue
        report = json.loads(path.read_text(encoding="utf-8"))
        print(f"\n### {name}\n")
        for key in ("downloads", "frame_alignment", "clips_evaluated", "clips", "signers", "hand_frame_fraction",
                    "publisher_coordinate_frame", "hand_assignment_vs_openpose"):
            if key in report:
                print(f"- {key}: `{json.dumps(report[key])}`")
        print()
        print(condition_table(report["summary"], sorted(report["summary"])))
        if report.get("out_of_vocabulary_false_positives"):
            print("\nOut-of-vocabulary clips (any gate acceptance is a false positive):\n")
            print("| condition | clips | accepted | rate | accepted labels |\n|---|---|---|---|---|")
            for condition, m in report["out_of_vocabulary_false_positives"].items():
                print(f"| {condition} | {m['n']} | {m['gate_accepted_false_positives']} | {pct(m['false_positive_rate'])} | {', '.join(m['accepted_labels'][:8])} |")
        if report.get("worker_outcomes"):
            print("\nEnd-to-end worker outcomes (real decoder, browser):\n")
            print("| worker / clips | clips | correct confirmed | wrong confirmed | nothing confirmed | model ran on | median / p90 model ms | mean hand-frame fraction |\n|---|---|---|---|---|---|---|---|")
            for key, m in sorted(report["worker_outcomes"].items()):
                print(f"| {key} | {m['clips']} | {m['correct_confirmed']} | {m['wrong_confirmed']} | {m['no_confirmation']} | "
                      f"{m['clips_with_model_inference']} | {m['model_ms_median_p90']} | {m['mean_hand_frame_fraction']} |")


if __name__ == "__main__":
    main()
