#!/usr/bin/env python3
"""Freeze the November 2026 accuracy-sprint development cohort.

Selection is deterministic and was fixed before any candidate was run:

* Source: PopSign ASL v2.1 publisher *validation* signers (``game/val``), CC BY 4.0.
  These signers were already used for V3.1 model selection and policy fitting, so
  everything here is development data, never independent validation.
* Supported signs: V3.1 classes ordered by sha256(SALT + "|" + directory), skipping
  classes already present in the shared/broad regression reels. The first 60 are
  taken and alternately assigned to half A (diagnosis/tuning) and half B
  (confirmation: run only for the baseline and for final adoption decisions).
* Unknown signs: only the vocabulary policy's ``calibration_only`` unknowns.
  ``test_only_never_seen`` signs, PopSign test rounds and the sealed SignRelay
  holdout are never listed or fetched.
* One clip per sign (two per unknown sign), chosen by the lowest
  sha256(SALT + "|" + filename) that is not already in an existing plan.

Videos are written to the ignored evaluation/videos/engine-comparison/sprint/.
Only URLs, hashes, sizes and labels are committed.
"""
import argparse
import hashlib
import json
import re
import sys
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "engine-v3" / "pipeline"))
from labels import canonical, load_policy  # noqa: E402

SALT = "signrelay-accuracy-sprint-2026-11-23"
SOURCE = "https://signdata.cc.gatech.edu/data/popsign_v2_1/game/val/"
SUPPORTED, UNKNOWN_CLIPS = 60, 2
OUT_DIR = Path("evaluation/videos/engine-comparison/sprint")


def h(text: str) -> str:
    return hashlib.sha256(f"{SALT}|{text}".encode()).hexdigest()


def fetch(url: str, limit: int | None = None) -> bytes:
    # curl handles this server's HTTP/2 listings, which urllib truncates through some proxies.
    command = ["curl", "-sSfL", "--retry", "4", "--retry-all-errors", "--proto", "=https", url]
    if limit is not None:
        command[1:1] = ["--max-filesize", str(limit)]
    return subprocess.run(command, check=True, capture_output=True).stdout


def listing(url: str) -> list[str]:
    html = fetch(url).decode("utf8", "replace")
    return [name for name in re.findall(r'href="([^"?/][^"]*)"', html) if not name.startswith("..")]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    parser.add_argument("--existing", type=Path, default=ROOT / "docs/showcase-2026-11-26/engine-comparison-development.json")
    args = parser.parse_args()

    policy = load_policy()
    classes = set(json.loads((ROOT / "engine-v3/vocabulary/classes-v3.0.json").read_text())["classes"])
    unknown = policy["unknown_signs"]
    sealed_signs = set(unknown["test_only_never_seen"]) | set(unknown["train_as_unknown"])
    existing = json.loads(args.existing.read_text())
    used_files = {Path(row["source"]).name for rows in existing.values() for row in rows}
    used_classes = {canonical(re.sub(r"[^a-z]", "", row["label"].lower()), policy) for rows in existing.values() for row in rows}

    directories = sorted(name.rstrip("/") for name in listing(SOURCE) if name.endswith("/"))
    known = [d for d in directories if d not in sealed_signs and d not in unknown["calibration_only"]
             and canonical(d, policy) in classes]
    by_class: dict[str, str] = {}
    for d in sorted(known, key=h):  # one directory per (possibly merged) class
        by_class.setdefault(canonical(d, policy), d)
    picked = [d for d in sorted(by_class.values(), key=h) if canonical(d, policy) not in used_classes][:SUPPORTED]
    unknowns = sorted(d for d in unknown["calibration_only"] if d in directories)

    rows = []
    def add(directory: str, label: str, category: str, halves: list[str]) -> None:
        names = (f.rstrip("/") for f in listing(SOURCE + directory + "/"))
        files = sorted((f for f in names if f.endswith(".mp4") and f not in used_files), key=h)
        for name, half in zip(files, halves):
            url = f"{SOURCE}{directory}/{name}"
            data = fetch(url, 30 * 1024 * 1024 + 1)
            if len(data) > 30 * 1024 * 1024:
                raise ValueError(f"{url}: unexpectedly large")
            path = OUT_DIR / directory / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
            rows.append({"video": str(path), "label": label, "category": category, "half": half,
                         "trial_id": f"sprint-{directory}-{name[:4]}-{half}", "source": url,
                         "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data),
                         "signer_prefix": name[:4], "license": "CC BY 4.0"})
            print(f"{category:18} {half} {label:14} {name}", flush=True)

    for index, directory in enumerate(picked):
        add(directory, canonical(directory, policy), "supported", ["A" if index % 2 == 0 else "B"])
    for directory in unknowns:
        add(directory, directory.upper(), "out_of_vocabulary", ["A", "B"][:UNKNOWN_CLIPS])
    unique = rows
    plan = {"salt": SALT, "source": SOURCE, "selection": __doc__.strip(),
            "A": [row for row in unique if row["half"] == "A"], "B": [row for row in unique if row["half"] == "B"]}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("x") as output:
        json.dump(plan, output, indent=1)
        output.write("\n")
    print({half: len(plan[half]) for half in "AB"})


if __name__ == "__main__":
    main()
