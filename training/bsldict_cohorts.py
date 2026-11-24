"""Select and fetch frozen BSL evaluation cohorts from BSLDict (Momeni et al., ACCV 2020).

BSLDict metadata: https://www.robots.ox.ac.uk/~vgg/research/bsldict/data/bsldict_v1.pkl
Licence: CC BY 4.0 (https://www.robots.ox.ac.uk/~vgg/research/bsldict/license.txt); copyright of each
video remains with its original owner (signbsl.com contributors). Videos are fetched only from the
dataset's own `video_link_db` URLs, stored in git-ignored evaluation/videos/bsldict/, never committed
or redistributed. YouTube-hosted entries are excluded.

Selection rule (fixed before any BSL result was produced; see docs/bsl-sprint-2026-11-24/PROTOCOL.md):
* supported  = BSLDict `word` (upper-cased) is an exact BSL-1K label;
  unsupported = BSL sign whose word is not a BSL-1K label (closed-set rejection test).
* BSLDict has no signer IDs. Source organisation is the signer proxy:
  development = "SignStation"; evaluation = every other *named* source; unattributed clips are excluded.
* Every showcase candidate label is included in both cohorts when a clip exists.
* The rest is a salted-SHA-256 ordered sample: one clip per label first, then extra clips.

  python3 -I training/bsldict_cohorts.py select evaluation/raw/bsldict/bsldict_v1.pkl
  python3 -I training/bsldict_cohorts.py fetch docs/bsl-sprint-2026-11-24/bsl-development.json
"""
from __future__ import annotations

import argparse
import hashlib
import importlib
import json
import pickle
import re
import time
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import Request, urlopen

SALT = "signrelay-bsl-sprint-2026-11-24"
HOSTS = {"media.signbsl.com", "www.ssc.education.ed.ac.uk"}
OUT = Path("evaluation/videos/bsldict")
DOCS = Path("docs/bsl-sprint-2026-11-24")
LABELS = Path("public/models/bsl1064-pose2sign/labels.json")
SIZES = {"development": (300, 60), "evaluation": (300, 60)}  # supported, unsupported
ALLOWED = {("numpy.core.multiarray", "_reconstruct"), ("numpy", "ndarray"), ("numpy", "dtype"),
           ("numpy.core.multiarray", "scalar"), ("numpy._core.multiarray", "_reconstruct"),
           ("numpy._core.multiarray", "scalar")}


class SafeUnpickler(pickle.Unpickler):
    def find_class(self, module, name):
        if (module, name) in ALLOWED:
            return getattr(importlib.import_module(module), name)
        raise pickle.UnpicklingError(f"blocked {module}.{name}")


def h(text: str) -> str:
    return hashlib.sha256(f"{SALT}|{text}".encode()).hexdigest()


def showcase() -> list[str]:
    doc = (DOCS / "SHOWCASE_REHEARSAL.md").read_text()
    return re.findall(r"^\| \d+ \| ([A-Z ]+?) \|", doc, flags=re.M)


def select(metadata: Path) -> None:
    data = SafeUnpickler(metadata.open("rb")).load()
    videos = data["videos"]
    labels = set(json.loads(LABELS.read_text()))
    featured = showcase()
    rows = {"development": {"supported": [], "unsupported": []}, "evaluation": {"supported": [], "unsupported": []}}
    for i, name in enumerate(videos["name"]):
        link = videos["video_link_db"][i] or ""
        if videos["download_method_db"][i] != "wget" or urlparse(link).netloc not in HOSTS:
            continue
        source = (videos["source_site_db"][i] or "").strip(" -") or "unattributed"
        if source == "unattributed":
            continue
        cohort = "development" if source == "SignStation" else "evaluation"
        word = str(videos["word"][i]).upper()
        kind = "supported" if word in labels else "unsupported"
        rows[cohort][kind].append({"index": i, "name": name, "word": word, "source": source, "url": link})
    manifests = {}
    for cohort, groups in rows.items():
        n_supported, n_unsupported = SIZES[cohort]
        chosen: list[dict] = []
        by_label: dict[str, list[dict]] = {}
        for row in sorted(groups["supported"], key=lambda row: h(row["name"])):
            by_label.setdefault(row["word"], []).append(row)
        for label in featured:  # showcase labels: every available clip, up to 3
            chosen += by_label.get(label, [])[:3]
        firsts = sorted((rows_[0] for label, rows_ in by_label.items() if label not in featured), key=lambda row: h(row["name"]))
        chosen += firsts[: max(0, n_supported - len(chosen))]
        if len(chosen) < n_supported:
            used = {row["name"] for row in chosen}
            extra = [row for row in sorted(groups["supported"], key=lambda row: h(row["name"])) if row["name"] not in used]
            chosen += extra[: n_supported - len(chosen)]
        unsupported = sorted(groups["unsupported"], key=lambda row: h(row["name"]))[:n_unsupported]
        trials = []
        for row in chosen + unsupported:
            supported = row in chosen
            trials.append({"trial_id": f"bsldict-{row['name'][:-4]}", "category": "supported" if supported else "unsupported",
                           "expected_gloss": row["word"] if supported else None, "bsldict_word": row["word"],
                           "signer_id": f"bsldict-source-{re.sub(r'[^A-Za-z0-9]+', '-', row['source']).strip('-').lower()}",
                           "cohort": cohort, "file": str(OUT / row["name"]), "recording_sha256": None,
                           "source": row["url"], "license": "BSLDict CC BY 4.0 (video copyright: original owner)",
                           "tags": ["showcase"] if row["word"] in featured and supported else []})
        manifests[cohort] = trials
        path = DOCS / f"bsl-{cohort}.json"
        path.write_text(json.dumps({"description": f"BSLDict {cohort} cohort, frozen by training/bsldict_cohorts.py (salt {SALT}). "
                                    "Media are not committed; fingerprints are recorded at first download.",
                                    "trials": trials}, indent=1) + "\n")
        print(f"{path}: {sum(t['category'] == 'supported' for t in trials)} supported "
              f"({len({t['expected_gloss'] for t in trials if t['expected_gloss']})} labels), "
              f"{sum(t['category'] == 'unsupported' for t in trials)} unsupported")
    overlap = {t["signer_id"] for t in manifests["development"]} & {t["signer_id"] for t in manifests["evaluation"]}
    assert not overlap, overlap


def fetch(manifest: Path) -> None:
    document = json.loads(manifest.read_text())
    changed = False
    for trial in document["trials"]:
        path = Path(trial["file"])
        if path.is_absolute() or ".." in path.parts or path.parts[:3] != ("evaluation", "videos", "bsldict"):
            raise ValueError("Output must stay in evaluation/videos/bsldict/")
        if urlparse(trial["source"]).netloc not in HOSTS:
            raise ValueError(f"Unexpected host for {trial['trial_id']}")
        if path.exists():
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            if trial["recording_sha256"] in (None, digest):
                if trial["recording_sha256"] is None:
                    trial["recording_sha256"], changed = digest, True
                continue
        try:
            with urlopen(Request(trial["source"], headers={"User-Agent": "SignRelay research evaluation (BSLDict)"}), timeout=60) as response:
                data = response.read(50 * 1024 * 1024)
        except Exception as error:  # record, never substitute
            print(f"unavailable {trial['trial_id']}: {error}")
            trial["unavailable"] = str(error)[:120]
            changed = True
            continue
        digest = hashlib.sha256(data).hexdigest()
        if trial["recording_sha256"] not in (None, digest):
            raise ValueError(f"Fingerprint differs from the frozen manifest: {trial['trial_id']}")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        trial["recording_sha256"], changed = digest, True
        trial.pop("unavailable", None)
        time.sleep(0.3)  # polite, sequential
    if changed:
        manifest.write_text(json.dumps(document, indent=1) + "\n")
    available = [t for t in document["trials"] if t["recording_sha256"] and not t.get("unavailable")]
    print(f"{manifest}: {len(available)}/{len(document['trials'])} clips available")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=["select", "fetch"])
    parser.add_argument("path", type=Path)
    args = parser.parse_args()
    select(args.path) if args.command == "select" else fetch(args.path)
