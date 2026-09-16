"""Evaluate all publisher-selected Bangla clips, retaining source coverage gaps."""
from __future__ import annotations

import argparse
from collections import Counter
import json
from pathlib import Path
import re
import statistics
import time
from urllib.parse import quote
import zipfile

from bdsl401_vocabulary import VOCABULARY, labels_for_codes
from export_bdsl401_onnx import HASHES, SPACE, SPACE_REVISION, digest, read_clip
from fetch_bdsl401_research_assets import fetch

ARCHIVE = "test data bdslw401.zip"
ARCHIVE_SHA256 = "e60e018aa9f39a6fe1064c96ac9d209b72aa1bb0681a304ce2c67655aa9a5bb3"


def unpack(archive: Path, output: Path) -> list[Path]:
    if digest(archive) != ARCHIVE_SHA256:
        raise ValueError("Publisher test archive checksum mismatch")
    with zipfile.ZipFile(archive) as bundle:
        files = [entry for entry in bundle.infolist() if not entry.is_dir()]
        codes = [Path(entry.filename).name[:4] for entry in files]
        expected = Counter({f"W{i:03}": 1 for i in range(1, 402) if i != 111})
        expected["W109"] = 2
        if len(files) != 401 or Counter(codes) != expected:
            raise ValueError("Unexpected publisher archive coverage: expected 401 files, W109 twice, W111 absent")
        if sum(entry.file_size for entry in files) > 600 * 1024 * 1024:
            raise ValueError("Archive expansion exceeds research limit")
        for entry in files:
            name = Path(entry.filename).name
            if not re.fullmatch(r"W\d{3}S\d{2}F_\d{2}\.mp4", name) or entry.file_size > 32 * 1024 * 1024:
                raise ValueError(f"Unexpected archive member: {name}")
        output.mkdir(parents=True, exist_ok=True)
        paths = []
        for entry in sorted(files, key=lambda item: item.filename):
            # Flatten explicitly validated basenames; never extract archive paths.
            path = output / Path(entry.filename).name
            path.write_bytes(bundle.read(entry))  # zipfile checks each member CRC
            paths.append(path)
        return paths


def evaluate(exported: Path, output: Path) -> dict:
    import numpy as np
    import onnxruntime as ort
    import torch
    project = Path(__file__).resolve().parents[1]
    if not output.resolve().is_relative_to(project / "work"):
        raise ValueError("Keep research inputs and outputs under work/")
    reference = json.loads((exported / "verification.json").read_text())
    model = exported / "model.onnx"
    if reference["sourceHashes"] != HASHES or digest(model) != reference["modelSha256"]:
        raise ValueError("Expected the verified original checkpoint export")
    codes = json.loads((exported / "class-codes.json").read_text())
    if codes != [f"W{i:03}" for i in range(1, 402)]:
        raise ValueError("Unexpected model class order")
    words = labels_for_codes(codes)
    archive = output / "publisher-test.zip"
    fetch(f"{SPACE}/resolve/{SPACE_REVISION}/{quote(ARCHIVE)}", archive, ARCHIVE_SHA256)
    paths = unpack(archive, output / "clips")
    torch.set_num_threads(2)
    options = ort.SessionOptions()
    options.intra_op_num_threads = 2
    session = ort.InferenceSession(str(model), options, providers=["CPUExecutionProvider"])
    results = []
    report_path = output / "publisher-clips.json"
    report_path.unlink(missing_ok=True)
    # Preserve progress and failures even if a process is interrupted.
    with (output / "publisher-progress.jsonl").open("w") as stream:
        for path in paths:
            entry = {"file": path.name, "sha256": digest(path), "expectedCode": path.name[:4]}
            try:
                inputs, frames = read_clip(path)
                started = time.perf_counter()
                logits = session.run(["logits"], {"pixel_values": inputs})[0]
                elapsed = (time.perf_counter() - started) * 1000
                if logits.shape != (1, 401) or not np.isfinite(logits).all():
                    raise ValueError("Invalid classifier output")
                order = np.argsort(-logits[0], kind="stable")
                top5 = [codes[index] for index in order[:5]]
                entry.update({"expectedEnglish": words[codes.index(entry["expectedCode"])],
                    "sourceFrames": frames, "top5Codes": top5,
                    "top5English": [words[index] for index in order[:5]],
                    "top1Correct": top5[0] == entry["expectedCode"],
                    "top5Correct": entry["expectedCode"] in top5,
                    "nativeInferenceMs": round(elapsed)})
            except (ValueError, RuntimeError) as error:
                entry.update({"error": str(error), "top1Correct": False, "top5Correct": False})
            results.append(entry)
            stream.write(json.dumps(entry, ensure_ascii=False) + "\n")
            stream.flush()
            print(json.dumps(entry, ensure_ascii=False), flush=True)
    result = {"source": f"{SPACE}/tree/{SPACE_REVISION}", "archiveSha256": ARCHIVE_SHA256,
        "modelSha256": reference["modelSha256"], "vocabularySha256": digest(VOCABULARY),
        "selection": "All 401 clips from the pinned publisher archive; 400 represented class codes",
        "missingClassCodes": ["W111"], "repeatedClassCodes": {"W109": 2},
        "total": len(paths), "errors": sum("error" in row for row in results),
        "top1Count": sum(row["top1Correct"] for row in results),
        "top5Count": sum(row["top5Correct"] for row in results),
        "distinctEnglishLabels": len(set(words)), "clips": results,
        "medianNativeInferenceMs": statistics.median([r["nativeInferenceMs"] for r in results if "nativeInferenceMs" in r]) if any("nativeInferenceMs" in r for r in results) else None,
        "versions": {"numpy": np.__version__, "onnxruntime": ort.__version__, "torch": torch.__version__},
        "limitations": "Publisher-selected clips, not an independent accuracy estimate; no live or browser claim. Sign-class accuracy retains separate classes with shared English labels.",
        "installed": False}
    report_path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    if result["errors"]:
        raise ValueError("Some clips failed; failures retained in the 401-clip denominator")
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("exported", type=Path)
    parser.add_argument("--output", type=Path, default=Path("work/bdsl401-publisher-test"))
    args = parser.parse_args()
    evaluate(args.exported, args.output)
