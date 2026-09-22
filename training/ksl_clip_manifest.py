"""Validate the complete, pinned publisher evaluation set before inference."""
from __future__ import annotations

import json
from pathlib import Path
import re

from export_ksl_onnx import sha256

DATASET_REVISION = "5dc76d221db9b74cc719cbbfb7528c7b5ec6a56d"
DATASET = "Seoyoung07/korean-sign-word-classifier-mediapipe-test-100"
MANIFEST = Path(__file__).with_name("ksl_test100_manifest.json")


def load_manifest(path: Path = MANIFEST) -> dict:
    manifest = json.loads(path.read_text(encoding="utf-8"))
    if manifest["dataset"] != DATASET or manifest["revision"] != DATASET_REVISION:
        raise ValueError("Unexpected Korean evaluation dataset revision")
    clips = manifest["clips"]
    if len(clips) != 100 or len({c["file"] for c in clips}) != 100:
        raise ValueError("Expected exactly 100 unique publisher clips")
    for clip in clips:
        name = clip["file"]
        if Path(name).name != name or "\\" in name or not name.endswith(".mp4"):
            raise ValueError("Invalid evaluation filename")
        if not re.fullmatch(r"[0-9a-f]{64}", clip["sha256"]):
            raise ValueError("Invalid clip checksum")
        if type(clip["bytes"]) is not int or not 0 < clip["bytes"] <= 80 * 1024 * 1024:
            raise ValueError("Invalid clip size")
        if not isinstance(clip["expected"], str) or not clip["expected"].strip():
            raise ValueError("Missing evaluation label")
    return manifest


def verify_clips(videos: Path, labels: list[str], manifest: dict) -> dict[str, str]:
    expected = {clip["file"]: clip for clip in manifest["clips"]}
    if {path.name for path in videos.glob("*.mp4")} != set(expected):
        raise ValueError("Evaluation directory must contain the exact manifest clip set")
    for name, clip in expected.items():
        path = videos / name
        if path.stat().st_size != clip["bytes"] or sha256(path) != clip["sha256"]:
            raise ValueError(f"Evaluation clip checksum or size mismatch: {name}")
        if clip["expected"] not in labels:
            raise ValueError(f"Evaluation label absent from checkpoint: {clip['expected']}")
    return {name: clip["expected"] for name, clip in expected.items()}
