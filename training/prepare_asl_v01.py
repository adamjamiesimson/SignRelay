"""Reproduce the 20-class Cloud Shell experiment without downloading videos.

This derived dataset lacks signer IDs, source-video IDs and an exact joint map.
It is suitable for an explicitly exploratory experiment, NOT model activation.
Source data and generated arrays stay under ignored work/, outside public/.
"""
from __future__ import annotations

import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import time
import urllib.request

import numpy as np

REVISION = "42072d9dedcfc7133a4d63715b68abb0f6db33eb"
REPOSITORY = "Kibalama/poseformer-sign-language"
TARGETS = ["drink", "go", "computer", "help", "who", "cold", "what", "yes",
           "brother", "family", "mother", "no", "why", "bad", "doctor",
           "good", "hot", "wait", "work", "yesterday"]
SHARDS = [
    (214498035, "15bdf080600c7aef6625346c859c061196d78baaa1627341bf83a61431cb1383"),
    (207334629, "bc29135562f1a3abd64a164c015d2664067b1c17561c1e215c9c65f9b083630e"),
    (211963958, "12821fb718eeacf8a7284808a99ba6a6df51310268bcbf106e8637b957f91f44"),
    (198324623, "3a3af8b66cd72d24bc21b269e024340e5870e8b7a3f9ceba2f523d9bf5bbbd13"),
]


def file_hash(path: Path) -> str:
    with path.open("rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()


def fetch_shard(directory: Path, index: int) -> Path:
    size, digest = SHARDS[index]
    name = f"train-{index:05d}-of-00004.parquet"
    path = directory / name
    if path.exists() and path.stat().st_size == size and file_hash(path) == digest:
        print(f"Verified cached {name}", flush=True)
        return path
    url = f"https://huggingface.co/datasets/{REPOSITORY}/resolve/{REVISION}/data/{name}"
    partial = path.with_suffix(".partial")
    for attempt in range(3):
        try:
            print(f"Downloading {name} ({size / 1e6:.1f} MB)", flush=True)
            total = 0
            hash_value = hashlib.sha256()
            with urllib.request.urlopen(url, timeout=90) as response, partial.open("wb") as out:
                while chunk := response.read(1024 * 1024):
                    total += len(chunk)
                    if total > size:
                        raise ValueError("Download exceeded the pinned size")
                    hash_value.update(chunk)
                    out.write(chunk)
            if total != size or hash_value.hexdigest() != digest:
                raise ValueError("Dataset checksum mismatch; refusing unverified data")
            partial.replace(path)
            print(f"Verified {name}", flush=True)
            return path
        except Exception:
            partial.unlink(missing_ok=True)
            if attempt == 2:
                raise
            time.sleep(2 * (attempt + 1))
    raise RuntimeError("Download failed")


def resample(sequence: np.ndarray, length: int = 96) -> np.ndarray:
    sequence = np.asarray(sequence, dtype=np.float32)
    if sequence.ndim != 3 or sequence.shape[1:] != (76, 3) or not len(sequence):
        raise ValueError("Expected a nonempty [frames, 76, 3] landmark sequence")
    if not np.isfinite(sequence).all():
        raise ValueError("Landmarks contain non-finite values")
    if not np.any(sequence):
        raise ValueError("Sequence has no observed landmarks")
    # Nearest frame sampling preserves missing-point sentinels without inventing
    # positions between absent and visible landmarks. Joint order is unchanged.
    indices = np.rint(np.linspace(0, len(sequence) - 1, length)).astype(np.int64)
    return sequence[indices]


def prepare(source: Path, output: Path) -> dict:
    import pyarrow.parquet as pq

    arrays, labels, lengths, ids, hashes = [], [], [], [], []
    rejected = []
    total_rows = 0
    for shard in sorted(source.glob("train-*-of-00004.parquet")):
        rows = 0
        parquet = pq.ParquetFile(shard)
        if set(parquet.schema_arrow.names) != {"landmarks", "label"}:
            raise ValueError("Dataset schema changed; re-audit its provenance")
        for batch in parquet.iter_batches(batch_size=16):
            for row in batch.to_pylist():
                row_id = f"{shard.name}:{rows}"
                rows += 1
                label = str(row["label"]).strip().lower()
                if label not in TARGETS:
                    continue
                try:
                    raw = np.asarray(row["landmarks"], dtype=np.float32)
                    sample = resample(raw)
                except (ValueError, TypeError) as error:
                    rejected.append({"id": row_id, "reason": str(error)})
                    continue
                arrays.append(sample)
                labels.append(TARGETS.index(label))
                lengths.append(len(raw))
                ids.append(row_id)
                hashes.append(hashlib.sha256(sample.astype("<f4").tobytes()).hexdigest())
        total_rows += rows
        print(f"Read {shard.name}: {rows} rows, {len(labels)} selected so far", flush=True)
    if not arrays or set(labels) != set(range(len(TARGETS))):
        raise ValueError("Missing target classes; no complete dataset was written")
    output.mkdir(parents=True, exist_ok=True)
    X = np.stack(arrays)
    np.savez_compressed(output / "v01_landmarks.npz", X=X, y=np.array(labels, dtype=np.int64),
                        labels=np.array(TARGETS), lengths=np.array(lengths),
                        sample_ids=np.array(ids), sequence_hashes=np.array(hashes))
    report = {
        "source": REPOSITORY, "revision": REVISION, "source_rows": total_rows,
        "samples": len(X), "shape": list(X.shape), "labels": TARGETS,
        "class_counts": dict(Counter(TARGETS[label] for label in labels)),
        "original_frames": {"min": min(lengths), "max": max(lengths), "mean": float(np.mean(lengths))},
        "rejected": rejected, "exact_duplicate_sequences": len(hashes) - len(set(hashes)),
        "archive_sha256": file_hash(output / "v01_landmarks.npz"),
        "license": "WLASL C-UDA; academic/non-commercial computational use",
        "activation_ready": False,
        "blockers": ["No signer IDs or source-video IDs in this derivative",
                     "Exact 76-joint ordering not documented by the dataset publisher",
                     "No official validation/test assignment retained",
                     "No consented NO_SIGN examples or real camera evaluation"],
    }
    (output / "preparation.json").write_text(json.dumps(report, indent=2) + "\n")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=Path("work/asl-v01/source"))
    parser.add_argument("--output", type=Path, default=Path("work/asl-v01/data"))
    parser.add_argument("--offline", action="store_true", help="Verify and use previously downloaded shards")
    args = parser.parse_args()
    args.source.mkdir(parents=True, exist_ok=True)
    if args.offline:
        for index, (size, digest) in enumerate(SHARDS):
            path = args.source / f"train-{index:05d}-of-00004.parquet"
            if not path.exists() or path.stat().st_size != size or file_hash(path) != digest:
                raise ValueError(f"Missing or invalid shard: {path.name}")
    else:
        with ThreadPoolExecutor(max_workers=2) as pool:
            list(pool.map(lambda index: fetch_shard(args.source, index), range(4)))
    print(json.dumps(prepare(args.source, args.output), indent=2))


if __name__ == "__main__":
    main()
