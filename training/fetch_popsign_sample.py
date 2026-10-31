"""Fetch a predetermined, multi-signer PopSign ASL v1.0 sample by byte range.

PopSign ASL v1.0 (Georgia Tech / Deaf Professional Arts Network) is CC BY 4.0.
Signers recorded on phones, so it is a different camera and signer population
from WLASL. Selection is fixed before any result is seen:

- in-vocabulary: signs whose PopSign name equals a WLASL2000 label once spaces
  and apostrophes are removed, seeded random choice of --in-vocab signs;
- out-of-vocabulary: every PopSign sign with no WLASL2000 label (real ASL signs
  the model cannot know: a no-sign/unsupported-movement control);
- per sign, the first clip of each of the first --signers distinct signers in
  archive order.

Only the chosen members are fetched (tar headers walked with range requests).
Videos stay in the given local directory and are never committed or uploaded.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import random
import re
from pathlib import Path

from secure_download import get

BASE = "https://signdata.cc.gatech.edu/data/popsign_v1_0/game"
USER_AGENT = "SignRelay evaluation (CC BY 4.0 PopSign; low-rate range requests)"


def members(url: str, limit: int):
    """Yield (name, data_offset, size) for regular files, header by header."""
    offset, long_name = 0, None
    for _ in range(limit):
        header = get(url, offset, 512)
        if len(header) < 512 or header == b"\0" * 512:
            return
        size = int(header[124:136].rstrip(b"\0 ").decode() or "0", 8)
        kind = header[156:157]
        name = header[0:100].rstrip(b"\0").decode("utf-8", "replace")
        prefix = header[345:500].rstrip(b"\0").decode("utf-8", "replace")
        data = offset + 512
        if kind == b"L":
            long_name = get(url, data, size).rstrip(b"\0").decode("utf-8", "replace")
        elif kind in (b"0", b"\0"):
            yield (long_name or (f"{prefix}/{name}" if prefix else name)), data, size
            long_name = None
        offset = data + (size + 511) // 512 * 512


def normalise(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", value.lower())


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("labels", type=Path, help="public/models/asl2000-tgcn/labels.json")
    parser.add_argument("videos", type=Path)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--split", default="test")
    parser.add_argument("--in-vocab", type=int, default=40)
    parser.add_argument("--signers", type=int, default=6)
    parser.add_argument("--max-headers", type=int, default=1500)
    args = parser.parse_args()
    labels = json.loads(args.labels.read_text(encoding="utf-8"))
    by_key = {normalise(label): label for label in labels}
    listing = get(f"{BASE}/{args.split}/").decode("utf-8", "replace")
    signs = sorted(set(re.findall(r'href="([A-Za-z0-9_]+)\.tar"', listing)))
    if not signs:
        raise SystemExit(f"No sign archives listed under {BASE}/{args.split}/")
    in_vocab = [sign for sign in signs if normalise(sign) in by_key]
    oov = [sign for sign in signs if normalise(sign) not in by_key]
    chosen = sorted(random.Random(20261030).sample(in_vocab, min(args.in_vocab, len(in_vocab))))
    args.videos.mkdir(parents=True, exist_ok=True)
    rows, header_reads = [], 0
    for sign in chosen + oov:
        url = f"{BASE}/{args.split}/{sign}.tar"
        signers: dict[str, tuple[str, int, int]] = {}
        try:
            for name, offset, size in members(url, args.max_headers):
                header_reads += 1
                if not name.endswith(".mp4"):
                    continue
                signer = Path(name).name.split("-")[0]
                if signer not in signers:
                    signers[signer] = (name, offset, size)
                if len(signers) >= args.signers:
                    break
        except Exception as error:
            raise RuntimeError(f"PopSign sample incomplete at {sign}: {error}") from error
        for signer, (name, offset, size) in signers.items():
            data = get(url, offset, size)
            if data[4:8] != b"ftyp":
                continue
            digest = hashlib.sha256(data).hexdigest()
            path = args.videos / f"{sign}-{signer}.mp4"
            path.write_bytes(data)
            label = by_key.get(normalise(sign))
            rows.append({"id": f"popsign-{sign}-{signer}", "file": str(path), "gloss": label or f"OOV:{sign}",
                         "group": "popsign-in-vocab" if label else "popsign-oov", "signer": signer,
                         "source": url, "archive_member": name, "archive_offset": offset, "bytes": size,
                         "recording_sha256": digest, "license": "CC BY 4.0"})
    if not rows:
        raise RuntimeError("PopSign sample is empty; no evaluation manifest written")
    args.manifest.write_text(json.dumps(rows, indent=1), encoding="utf-8")
    print(json.dumps({"split": args.split, "archives": len(signs), "in_vocab_available": len(in_vocab), "in_vocab_chosen": len(chosen),
                      "oov_signs": oov, "clips": len(rows), "distinct_signers": len({row["signer"] for row in rows}),
                      "header_reads": header_reads}))


if __name__ == "__main__":
    main()
