"""Recover all 401 English labels from the original dataset's pinned PDF.

Table extraction drops nine first rows because their upper borders are absent.
Use the printed class codes and fixed column boundaries instead. Bangla PDF
text has broken character mappings, so it is deliberately not used as labels.
"""
from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import re

PDF_SHA256 = "7996295dbdadbd0c4baa7e3c19e5c91c683a7e437467da6adf8bed1ba41099bd"
PDF_URL = "https://www.kaggle.com/api/v1/datasets/download/hasanssl/bdslw401/bdsl%20words-complete.pdf?datasetVersionNumber=2"
SOURCE = "https://www.kaggle.com/datasets/hasanssl/bdslw401/versions/2"
WRAP_REPAIRS = {
    "W009": ("Grandmother/Matern al Grandmother", "Grandmother/Maternal Grandmother"),
    "W011": ("Husband’s Younger Brother (Brother-in- Law)", "Husband’s Younger Brother (Brother-in-Law)"),
    "W036": ("Husband’s Elder Brother (Brother-in- Law)", "Husband’s Elder Brother (Brother-in-Law)"),
    "W263": ("Arrange/Furnish/Org anize", "Arrange/Furnish/Organize"),
}


def extract(pdf_path: Path) -> dict:
    import pdfplumber
    if hashlib.sha256(pdf_path.read_bytes()).hexdigest() != PDF_SHA256:
        raise ValueError("Original BdSLW401 vocabulary PDF checksum mismatch")
    rows = []
    with pdfplumber.open(pdf_path) as pdf:
        if len(pdf.pages) != 11:
            raise ValueError("Expected the original 11-page word list")
        for page_number, page in enumerate(pdf.pages, 1):
            codes = [word for word in page.extract_words()
                     if word["x0"] < 150 and re.fullmatch(r"W\d{3}", word["text"])]
            for index, word in enumerate(codes):
                top = word["top"] - 1
                bottom = codes[index + 1]["top"] - 1 if index + 1 < len(codes) else page.height - 50
                text = page.crop((422.95, top, 539.86, bottom)).extract_text()
                english = " ".join((text or "").split())
                code = word["text"]
                if code in WRAP_REPAIRS:
                    original, replacement = WRAP_REPAIRS[code]
                    if english != original:
                        raise ValueError(f"Unexpected text at documented line wrap: {code}")
                    english = replacement
                if not english or re.fullmatch(r"W\d{3}", english):
                    raise ValueError(f"Missing readable label for {code}")
                rows.append({"code": code, "english": english, "sourcePage": page_number})
    if [row["code"] for row in rows] != [f"W{i:03}" for i in range(1, 402)]:
        raise ValueError("PDF must contain W001–W401 once each, in model output order")
    counts = Counter(row["english"] for row in rows)
    return {
        "source": SOURCE, "sourceFile": "bdsl words-complete.pdf", "sourceSha256": PDF_SHA256,
        "sourceLicenseAsPublished": "CC-BY-NC-ND-4.0",
        "attribution": "Husne Ara Rubaiyeat, Njayou Youssouf, Md Kamrul Hasan, Hasan Mahmud; BdSLW401 dataset",
        "extraction": "Printed W### row positions and English column; four visually checked line-wrap repairs",
        "classes": len(rows), "distinctEnglishLabels": len(counts),
        "repeatedEnglishLabels": {label: count for label, count in counts.items() if count > 1},
        "wrapRepairs": {code: {"extracted": pair[0], "display": pair[1]} for code, pair in WRAP_REPAIRS.items()},
        "limitations": "Source English glosses, not an independent linguistic review. Distinct sign classes may share an English gloss. Original Bangla text extraction is unsuitable for display. This file does not activate a recognition model.",
        "entries": rows,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pdf", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = extract(args.pdf)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({k: v for k, v in result.items() if k != "entries"}, ensure_ascii=False, indent=2))
