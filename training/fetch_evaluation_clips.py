"""Fetch exactly the frozen PopSign evaluation clips, not entire archives.
CC BY 4.0: Georgia Tech Contextual Computing Group / Deaf Professional Arts Network.
Raw videos stay in ignored evaluation/videos/. Nothing is uploaded.
"""
import argparse
import hashlib
import json
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import Request, urlopen

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("manifest", type=Path, nargs="?", default=Path("docs/evaluation/popsign-project-holdout-manifest.json"))
parser.add_argument("--cohort-lock", type=Path, default=Path("docs/evaluation/cohort-lock-2026-10-16.json"))
parser.add_argument("--final-holdout", action="store_true",
                    help="Authorized once-only final measurement of a frozen candidate. Never use for development.")
args = parser.parse_args()
rows = json.loads(args.manifest.read_text())
# The cohort lock, not a row label, decides what is sealed: historical rows are
# labelled held_out but locked as development. Match sealed clips by fingerprint
# so a copied or renamed manifest cannot fetch them either.
sealed = set()
for entry in json.loads(args.cohort_lock.read_text())["manifests"]:
    if entry["role"] == "sealed-holdout":
        sealed.update(item["recording_sha256"] for item in json.loads(Path(entry["file"]).read_text()))
requested = [row["trial_id"] for row in rows if row.get("recording_sha256") in sealed]
if requested and not args.final_holdout:
    raise SystemExit(f"Refusing to fetch {len(requested)} sealed holdout clip(s); they stay unseen until an authorized --final-holdout run.")
for row in rows:
    path = Path(row["file"])
    if path.is_absolute() or ".." in path.parts or path.parts[:2] != ("evaluation", "videos"):
        raise ValueError("Evaluation output must stay in evaluation/videos/")
    if path.exists() and hashlib.sha256(path.read_bytes()).hexdigest() == row["recording_sha256"]:
        print(f"Verified cached clip {row['trial_id']}")
        continue
    url = row["source"]
    if urlparse(url).scheme != "https" or urlparse(url).netloc != "signdata.cc.gatech.edu":
        raise ValueError("Only the reviewed official PopSign source is supported")
    start, size = int(row["archive_offset"]), int(row["bytes"])
    if start < 0 or not 0 < size < 100 * 1024 * 1024:
        raise ValueError("Invalid source range")
    with urlopen(Request(url, headers={"Range": f"bytes={start}-{start + size - 1}"}), timeout=60) as response:
        if response.status != 206:
            raise ValueError("Source must honor byte-range requests")
        data = response.read(size + 1)
    if len(data) != size or hashlib.sha256(data).hexdigest() != row["recording_sha256"]:
        raise ValueError("Clip fingerprint/size differs from frozen manifest")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    print(f"Verified clip {row['trial_id']}")
