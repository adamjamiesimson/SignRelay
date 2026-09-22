"""Join verified source glosses by class code, never by dictionary order."""
from __future__ import annotations

import json
from pathlib import Path

from extract_bdsl401_vocabulary import PDF_SHA256

VOCABULARY = Path(__file__).with_name("bdsl401_vocabulary.json")


def labels_for_codes(codes: list[str], path: Path = VOCABULARY) -> list[str]:
    vocabulary = json.loads(path.read_text(encoding="utf-8"))
    if vocabulary["sourceSha256"] != PDF_SHA256:
        raise ValueError("Unexpected vocabulary source")
    entries = vocabulary["entries"]
    expected = {f"W{i:03}" for i in range(1, 402)}
    mapping = {entry["code"]: entry["english"] for entry in entries}
    if len(entries) != 401 or set(mapping) != expected or len(codes) != 401 or set(codes) != expected:
        raise ValueError("Vocabulary and checkpoint must cover all 401 unique class codes")
    if any(not isinstance(label, str) or not label.strip() for label in mapping.values()):
        raise ValueError("Every classifier output needs a readable label")
    return [mapping[code] for code in codes]
