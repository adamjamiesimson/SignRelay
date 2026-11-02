"""Frozen full catalogs, three matched runtimes, aggregate-only publication.

Control is candidate with ONLY its CTC session restored to the exact parent.
No raw recording rows, text, tensors or persistent identifiers leave this job.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

p = argparse.ArgumentParser()
p.add_argument("kind", choices=["positive", "negative"])
p.add_argument("chrome")
p.add_argument("--baseline", required=True)
p.add_argument("--candidate", required=True)
p.add_argument("--control", required=True)
p.add_argument("--out", required=True)
args = p.parse_args()
roots = {k: Path(getattr(args, k)).resolve() for k in ["baseline", "candidate", "control"]}
candidate = roots["candidate"]
output = Path(args.out).resolve()
output.parent.mkdir(parents=True, exist_ok=True)
positive = args.kind == "positive"
prepare = "scripts/diagnostics/fingerspelling-camera-prepare.py" if positive else "scripts/diagnostics/fingerspelling-reliability-negative-camera.py"
counts = {k: dict(captures=0, exact=0, characterErrors=0, referenceCharacters=0, candidates=0, abstentions=0, nativeParity=0, technicalFailures=0) for k in roots}
paired = dict(fixedInputs=0, workerRuns=0, disagreements=0, coldVersusResetDisagreements=0, sourceParity=0)
rows = {k: [] for k in roots}  # local only; never written or logged
repeat = int(os.environ.get("REPEAT", "1"))

def run(command, root):
    try:
        return subprocess.run(command, cwd=root, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=240, check=False).returncode == 0
    except (subprocess.TimeoutExpired, OSError):
        return False

def distance(a, b):
    previous = list(range(len(b)+1))
    for i, left in enumerate(a, 1):
        current = [i]
        for j, right in enumerate(b, 1):
            current.append(min(current[j-1]+1, previous[j]+1, previous[j-1]+(left != right)))
        previous = current
    return previous[-1]

def save():
    same = {}
    for name in ["baseline", "control"]:
        pairs = list(zip(rows[name], rows["candidate"]))
        same[name+"VsCandidate"] = {"pairs": len(pairs), "sameOutput": sum(a["prediction"] == b["prediction"] for a, b in pairs), "sameInput": sum(bool(a.get("inputSha256")) and a.get("inputSha256") == b.get("inputSha256") for a, b in pairs)}
    report = dict(kind="Matched full frozen RGB catalogs, three variants; aggregate-only diagnostic, not new signer validation", catalog=args.kind, repeat=repeat, planned=len(cases), variants=counts, matched=paired, comparisons=same, complete=all(c["captures"] == len(cases) and not c["technicalFailures"] for c in counts.values()))
    output.write_text(json.dumps(report, indent=2)+"\n")

catalog = [sys.executable, "scripts/diagnostics/fingerspelling-camera-cases.py"] if positive else [sys.executable, prepare, "--catalog"]
assert run(catalog, candidate), "Frozen catalog unavailable"
cases = json.loads((candidate / "work/fingerspelling-camera" / ("cases.json" if positive else "negative-cases.json")).read_text())
assert len(cases) == (10 if positive else 29)
# Assert the ablation's exact source boundary before any inference.
base_session = (roots["baseline"] / "lib/fingerspelling-ctc-session.ts").read_bytes()
assert (roots["control"] / "lib/fingerspelling-ctc-session.ts").read_bytes() == base_session
for file in ["lib/fingerspelling-capture.ts", "lib/fingerspelling-sampling.ts", "lib/fingerspelling-model.ts", "lib/fingerspelling-ctc-runtime.ts", "lib/fingerspelling-decoding.ts", "workers/fingerspelling.worker.ts", "public/workers/fingerspelling.worker.js"]:
    hashes = {hashlib.sha256((r/file).read_bytes()).hexdigest() for r in roots.values()}
    assert len(hashes) == 1, "Unexpected inference/capture source difference"
roots_file = candidate / "work/sprint-causal-roots.json"
roots_file.write_text(json.dumps({k:str(v) for k,v in roots.items()}))
for index, case in enumerate(cases):
    identifier = case["id"]
    assert Path(identifier).name == identifier and identifier not in (".", "..")
    relative = Path("work/fingerspelling-camera") / identifier
    try:
        if not run([sys.executable, prepare, identifier], candidate):
            for c in counts.values(): c["technicalFailures"] += 1
            continue
        source = json.loads((candidate / relative / "source.json").read_text())
        camera = candidate / relative / "known-fsboard.y4m"
        assert hashlib.sha256(camera.read_bytes()).hexdigest() == source["virtualCameraSha256"]
        for name in ["baseline", "control"]:
            (roots[name]/relative).mkdir(parents=True, exist_ok=True)
            for file in ["source.json", "known-fsboard.y4m"]: shutil.copy2(candidate/relative/file, roots[name]/relative/file)
        paired["sourceParity"] += 1
        names = list(roots)
        shift = (index+repeat) % 3
        names = names[shift:]+names[:shift]
        for name in names:
            root = roots[name]
            result = root / "outputs" / f"fingerspelling-recorded-camera-{identifier}.json"
            result.unlink(missing_ok=True)
            (root/relative/"actual-captured-features.json").unlink(missing_ok=True)
            ok = run(["node", "scripts/diagnostics/fingerspelling-camera-browser.mjs", args.chrome, identifier], root)
            ok = ok and run([sys.executable, "scripts/diagnostics/fingerspelling-camera-onnx.py", identifier], root)
            if not ok:
                counts[name]["technicalFailures"] += 1
                continue
            r = json.loads(result.read_text())
            rows[name].append(r)
            c = counts[name]
            text = r["prediction"].strip()
            reference = r.get("reference", r["source"]["reference"])
            c["captures"] += 1
            c["exact"] += text == reference
            c["characterErrors"] += distance(reference, text)
            c["referenceCharacters"] += len(reference)
            c["candidates"] += bool(text)
            c["abstentions"] += not text
            c["nativeParity"] += bool(r.get("nativeCapturedTextParity"))
        # Replay ONE actual captured tensor, unmodified, through each session.
        features = candidate/relative/"actual-captured-features.json"
        if features.exists():
            fixed = candidate/"work/sprint-causal-fixed.json"
            fixed.unlink(missing_ok=True)
            if not run(["node", "scripts/diagnostics/sprint-fixed-input.mjs", args.chrome, str(features), str(roots_file), str(fixed)], candidate):
                raise RuntimeError("Matched fixed-input replay failed")
            results = json.loads(fixed.read_text())["outputs"]
            paired["fixedInputs"] += 1
            paired["workerRuns"] += len(results)
            paired["disagreements"] += len({(r["text"],r["status"]) for r in results}) != 1
            for name in roots:
                pair = [r for r in results if r["variant"] == name]
                paired["coldVersusResetDisagreements"] += pair[0] != {**pair[1], "pass": 0}
    finally:
        for root in roots.values(): (root/relative/"known-fsboard.y4m").unlink(missing_ok=True)
        save()
    print("Completed matched catalog position", index+1, "of", len(cases), flush=True)
save()
assert all(c["captures"] == len(cases) and not c["technicalFailures"] for c in counts.values()), "Full catalog incomplete"
assert paired["disagreements"] == 0 and paired["coldVersusResetDisagreements"] == 0, "Identical input produced differing output"
