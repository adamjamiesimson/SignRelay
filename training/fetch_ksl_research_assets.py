"""Fetch hash-pinned Korean research inputs outside public app directories."""
from __future__ import annotations

import argparse
from pathlib import Path
import time
from urllib.parse import quote
from urllib.request import urlopen

from export_ksl_onnx import SOURCE_HASHES, SOURCE_REPO, SOURCE_REVISION, sha256
from evaluate_ksl_clips import EXTRACTOR_SHA256, TASK_SHA256

DATASET_REVISION = "5dc76d221db9b74cc719cbbfb7528c7b5ec6a56d"
DATASET = "Seoyoung07/korean-sign-word-classifier-mediapipe-test-100"
CLIPS = {
    "간호사.mp4": "b73a2c8a9c833e0362d9854d793934093320476a216f173d5012b3749a70819e",
    "갈등.mp4": "1ab03144dfe6a4c377f4d915a39152579cfb637530e1c619127282081c5404ea",
    "갈색.mp4": "6ae48f443aea052df8b5734f3145105641c77aac015a9baae93560c0c10aa313",
}


def fetch(url: str, path: Path, expected: str):
    if path.is_file() and sha256(path) == expected:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".partial")
    try:
        for attempt in range(3):
            try:
                size = 0
                with urlopen(url, timeout=45) as response, temporary.open("wb") as stream:
                    while chunk := response.read(1024 * 1024):
                        size += len(chunk)
                        if size > 80 * 1024 * 1024:
                            raise ValueError("Research asset exceeded its download size limit")
                        stream.write(chunk)
                if sha256(temporary) != expected:
                    raise ValueError(f"Checksum mismatch: {path.name}")
                temporary.replace(path)
                print(f"Verified {path.name}: {size} bytes", flush=True)
                return
            except OSError:
                if attempt == 2:
                    raise
                time.sleep(2 ** attempt)
    finally:
        temporary.unlink(missing_ok=True)


def download(root: Path):
    root = root.resolve()
    project = Path(__file__).resolve().parents[1]
    if not root.is_relative_to(project / "work"):
        raise ValueError("Place research assets under the Git-ignored work/ directory")
    sources = {**SOURCE_HASHES, "model/keypoint_extractor.py": EXTRACTOR_SHA256,
               "model/assets/holistic_landmarker.task": TASK_SHA256}
    for name, expected in sources.items():
        fetch(f"https://huggingface.co/{SOURCE_REPO}/resolve/{SOURCE_REVISION}/{name}",
              root / "source" / name, expected)
    for name, expected in CLIPS.items():
        fetch(f"https://huggingface.co/datasets/{DATASET}/resolve/{DATASET_REVISION}/videos/{quote(name)}",
              root / "clips" / name, expected)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("work/ksl-research"))
    args = parser.parse_args()
    download(args.output)
