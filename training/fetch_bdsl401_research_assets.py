"""Download only hash-pinned Bangla research inputs into Git-ignored work/."""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
import time
from urllib.request import urlopen

from export_bdsl401_onnx import CLIPS, HASHES, REVISION, SOURCE, SPACE, SPACE_REVISION, digest


def fetch(url: str, path: Path, expected: str):
    if path.is_file() and digest(path) == expected:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    pending = path.with_name(path.name + ".partial")
    try:
        for attempt in range(3):
            try:
                size = 0
                with urlopen(url, timeout=45) as response, pending.open("wb") as stream:
                    while chunk := response.read(1024 * 1024):
                        size += len(chunk)
                        if size > 400 * 1024 * 1024:
                            raise ValueError("Research asset exceeds 400 MiB limit")
                        stream.write(chunk)
                if digest(pending) != expected:
                    raise ValueError(f"Pinned asset mismatch: {path.name}")
                pending.replace(path)
                print(f"Verified {path.name}: {size} bytes", flush=True)
                return
            except OSError:
                if attempt == 2:
                    raise
                time.sleep(2 ** attempt)
    finally:
        pending.unlink(missing_ok=True)


def download(root: Path):
    root = root.resolve()
    project = Path(__file__).resolve().parents[1]
    if not root.is_relative_to(project / "work"):
        raise ValueError("Place research inputs under Git-ignored work/")
    assets = [(f"https://huggingface.co/{SOURCE}/resolve/{REVISION}/{name}",
               root / "source" / name, expected) for name, expected in HASHES.items()]
    assets.extend((f"{SPACE}/resolve/{SPACE_REVISION}/{name}", root / "clips" / name, expected)
                  for name, expected in CLIPS.items())
    with ThreadPoolExecutor(max_workers=3) as pool:
        futures = [pool.submit(fetch, *asset) for asset in assets]
        for future in as_completed(futures):
            future.result()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("work/bdsl401-research"))
    download(parser.parse_args().output)
