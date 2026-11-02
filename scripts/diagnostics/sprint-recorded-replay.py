"""Complete exposed RGB regression catalog; keep technical failures in its ledger.

This driver never selects cases by predictions, trains a model, reads sealed
holdouts, weakens source verification, or uploads pixels/landmark tensors.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

parser = argparse.ArgumentParser()
parser.add_argument("kind", choices=["positive", "negative"])
parser.add_argument("chrome")
parser.add_argument("--out", required=True)
args = parser.parse_args()
root = Path("work/fingerspelling-camera")
positive = args.kind == "positive"
prepare = "scripts/diagnostics/fingerspelling-camera-prepare.py" if positive else "scripts/diagnostics/fingerspelling-reliability-negative-camera.py"
catalog_command = [sys.executable, "scripts/diagnostics/fingerspelling-camera-cases.py"] if positive else [sys.executable, prepare, "--catalog"]
subprocess.run(catalog_command, check=True, stdin=subprocess.DEVNULL)
cases = json.loads((root / ("cases.json" if positive else "negative-cases.json")).read_text())
assert len(cases) == (10 if positive else 29)
assert len({c["id"] for c in cases}) == len(cases)
# Resolve the existing contract rather than inventing a new asset filename.
contract = json.loads(Path("docs/fingerspelling/evidence/upright-runtime.json").read_text())
model = Path("public" + contract["url"])
expected = "34c823aef5eaa3e4b74c564138a1a224f8c9a8426e0f69a331d5c01fbf53008b"
assert hashlib.sha256(model.read_bytes()).hexdigest() == expected
ledger = []
for case in cases:
    example = case["id"]
    output = Path("outputs") / f"fingerspelling-recorded-camera-{example}.json"
    # Each invocation owns its output; never count an earlier successful file.
    output.unlink(missing_ok=True)
    stages = [
        ("verified-source", [sys.executable, prepare, example]),
        ("rgb-browser", ["node", "scripts/diagnostics/fingerspelling-camera-browser.mjs", args.chrome, example]),
        ("native-parity", [sys.executable, "scripts/diagnostics/fingerspelling-camera-onnx.py", example]),
    ]
    try:
        for stage, command in stages:
            try:
                run = subprocess.run(command, stdin=subprocess.DEVNULL, timeout=240, check=False)
            except (subprocess.TimeoutExpired, OSError) as error:
                ledger.append({"id": example, "technicalFailure": True, "stage": stage, "error": type(error).__name__})
                break
            if run.returncode:
                ledger.append({"id": example, "technicalFailure": True, "stage": stage, "returncode": run.returncode})
                break
        else:
            try:
                row = json.loads(output.read_text())
                if row["modelSha256"] != expected:
                    raise ValueError("Unexpected model identity")
                ledger.append({"id": example, "technicalFailure": False, "result": row})
            except (OSError, ValueError, KeyError) as error:
                ledger.append({"id": example, "technicalFailure": True, "stage": "result-integrity", "error": type(error).__name__})
    finally:
        (root / example / "known-fsboard.y4m").unlink(missing_ok=True)
    # Preserve partial evidence even if the runner's overall budget expires.
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps({"kind": args.kind, "planned": len(cases), "cases": ledger, "complete": False}, indent=2))

def edits(a, b):
    prior = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        current = [i]
        for j, y in enumerate(b, 1):
            current.append(min(current[-1] + 1, prior[j] + 1, prior[j-1] + (x != y)))
        prior = current
    return prior[-1]

successful = [r["result"] for r in ledger if not r["technicalFailure"]]
complete = len(successful) == len(cases)
pairs = [(r.get("reference", r["source"].get("reference", "")), r.get("prediction", "").strip()) for r in successful]
summary = {
    "exact": sum(a == b for a, b in pairs) if positive and complete else None,
    "characterErrors": sum(edits(a, b) for a, b in pairs) if positive and complete else None,
    "referenceCharacters": sum(len(a) for a, _ in pairs) if positive and complete else None,
    "candidates": sum(bool(b) for _, b in pairs),
    "abstentions": sum(not b for _, b in pairs),
    "technicalFailures": len(cases) - len(successful),
}
report = {"kind": "Previously exposed RGB regression recordings; correlated repeats; not fresh final, physical camera or independent intent validation",
          "catalog": args.kind, "variant": os.environ.get("VARIANT"), "repeat": os.environ.get("REPEAT"),
          "sourceSha": subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip(),
          "modelSha256": expected, "planned": len(cases), "completed": len(successful), "complete": complete,
          "summary": summary, "cases": ledger}
Path(args.out).write_text(json.dumps(report, indent=2))
print("SPRINT-RECORDED-LEDGER", json.dumps(report), flush=True)
sys.exit(0 if complete else 1)
