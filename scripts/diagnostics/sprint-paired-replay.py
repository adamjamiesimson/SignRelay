"""Alternate both implementations on every frozen case on the SAME runner.

Preparation and checksums remain the established verified-source path. Copies
are local, byte-identical Y4M input, never substituted landmark observations.
All predetermined cases and technical failures enter both output ledgers.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys

p = argparse.ArgumentParser()
p.add_argument("kind", choices=["positive", "negative"])
p.add_argument("chrome")
p.add_argument("--baseline", required=True)
p.add_argument("--candidate", required=True)
p.add_argument("--out", required=True)
args = p.parse_args()
roots = {"baseline": Path(args.baseline).resolve(), "candidate": Path(args.candidate).resolve()}
out = Path(args.out).resolve()
out.mkdir(parents=True, exist_ok=True)
repeat = int(os.environ.get("REPEAT", "1"))
model_sha = "34c823aef5eaa3e4b74c564138a1a224f8c9a8426e0f69a331d5c01fbf53008b"
positive = args.kind == "positive"
prepare = "scripts/diagnostics/fingerspelling-camera-prepare.py" if positive else "scripts/diagnostics/fingerspelling-reliability-negative-camera.py"
catalog = [sys.executable, "scripts/diagnostics/fingerspelling-camera-cases.py"] if positive else [sys.executable, prepare, "--catalog"]
subprocess.run(catalog, cwd=roots["candidate"], check=True, stdin=subprocess.DEVNULL)
cases = json.loads((roots["candidate"] / "work/fingerspelling-camera" / ("cases.json" if positive else "negative-cases.json")).read_text())
assert len(cases) == (10 if positive else 29) and len({c["id"] for c in cases}) == len(cases)
sources = {}
for name, root in roots.items():
    contract = json.loads((root / "docs/fingerspelling/evidence/upright-runtime.json").read_text())
    assert hashlib.sha256((root / ("public" + contract["url"])).read_bytes()).hexdigest() == model_sha
    sources[name] = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip()
hardware = {"platform": platform.platform(), "cpu": subprocess.check_output(["lscpu"], text=True),
            "chrome": subprocess.check_output([args.chrome, "--version"], text=True).strip()}
ledgers = {name: [] for name in roots}

def run(command, root):
    try:
        r = subprocess.run(command, cwd=root, stdin=subprocess.DEVNULL, timeout=240, check=False)
        return None if r.returncode == 0 else {"returncode": r.returncode}
    except (subprocess.TimeoutExpired, OSError) as error:
        return {"error": type(error).__name__}

def persist():
    for name, rows in ledgers.items():
        success = sum(not row["technicalFailure"] for row in rows)
        report = {"kind": "Same-runner, alternating genuine RGB regression replay; exposed recordings, not fresh final or physical webcam evidence",
                  "catalog": args.kind, "variant": name, "repeat": str(repeat), "sourceSha": sources[name],
                  "modelSha256": model_sha, "planned": len(cases), "completed": success,
                  "complete": len(rows) == len(cases) and success == len(cases), "pairedSameHost": True,
                  "hardware": hardware, "order": "Alternating per case; reverse on even repetitions", "cases": rows}
        filename = f"ci-positive-{name}-{repeat}.json" if positive else f"ci-negative-{name}.json"
        (out / filename).write_text(json.dumps(report, indent=2))

for index, case in enumerate(cases):
    example = case["id"]
    relative = Path("work/fingerspelling-camera") / example
    try:
        failed = run([sys.executable, prepare, example], roots["candidate"])
        if failed:
            for name in roots:
                ledgers[name].append({"id": example, "technicalFailure": True, "stage": "verified-source", **failed})
            continue
        source = json.loads((roots["candidate"] / relative / "source.json").read_text())
        camera = roots["candidate"] / relative / "known-fsboard.y4m"
        assert hashlib.sha256(camera.read_bytes()).hexdigest() == source["virtualCameraSha256"]
        (roots["baseline"] / relative).mkdir(parents=True, exist_ok=True)
        for file in ["known-fsboard.y4m", "source.json"]:
            shutil.copy2(roots["candidate"] / relative / file, roots["baseline"] / relative / file)
        names = ["baseline", "candidate"] if (index + repeat) % 2 else ["candidate", "baseline"]
        for name in names:
            root = roots[name]
            output = root / "outputs" / f"fingerspelling-recorded-camera-{example}.json"
            output.unlink(missing_ok=True)
            stages = [("rgb-browser", ["node", "scripts/diagnostics/fingerspelling-camera-browser.mjs", args.chrome, example]),
                      ("native-parity", [sys.executable, "scripts/diagnostics/fingerspelling-camera-onnx.py", example])]
            for stage, command in stages:
                failed = run(command, root)
                if failed:
                    ledgers[name].append({"id": example, "technicalFailure": True, "stage": stage, **failed})
                    break
            else:
                try:
                    row = json.loads(output.read_text())
                    assert row["modelSha256"] == model_sha
                    ledgers[name].append({"id": example, "technicalFailure": False, "result": row})
                except (OSError, ValueError, KeyError, AssertionError) as error:
                    ledgers[name].append({"id": example, "technicalFailure": True, "stage": "result-integrity", "error": type(error).__name__})
    finally:
        for root in roots.values():
            (root / relative / "known-fsboard.y4m").unlink(missing_ok=True)
        persist()
    print("SAME-HOST-PAIR-COMPLETE", example, flush=True)
persist()
assert all(len(rows) == len(cases) and all(not r["technicalFailure"] for r in rows) for rows in ledgers.values()), "Every predetermined case must complete in both implementations"
