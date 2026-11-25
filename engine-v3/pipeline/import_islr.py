"""Import the Google ISLR (Kaggle 2023) landmark dataset into this project's cache format.

The competition ships MediaPipe Holistic landmarks rather than video: per frame, 468 face points,
21 right-hand points, 33 pose points and 21 left-hand points, as parquet rows keyed by sequence. This
script turns those into the same per-clip arrays `build_cache.py` produces, so the dataset becomes
extra training material without touching the PopSign cache it is merged with.

  cache/islr_train.npz   pts float16 [sumT, 86, 3] (NaN = missing), offsets int64 [N+1]
  cache/islr_train.json  one row per clip: key, sign, signer, frames, hand_frames, width, height, fps, duration

Point order and aspect correction follow `engine-v3/pipeline/points.py`, so a clip from this dataset
and a clip from PopSign are interchangeable to the trainer. Nothing here writes to the existing
train/val/test arrays; `merge_cache.py` does that, and keeps the originals.

Splits are by participant, never by clip, so no signer appears in both training and validation. The
competition's own split is not used: it has no participant-disjoint guarantee that we can verify
against this project's evaluation.

Usage:
  python import_islr.py --landmarks islr/train_landmark_files --meta islr/train.csv --out cache
  python import_islr.py --landmarks ... --meta ... --out cache --limit 40 --max-per-class 60
"""
import argparse, csv, json, math, os, sys
from collections import defaultdict

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from points import POSE, FACE, N_POINTS  # noqa: E402

N_HAND, P_POSE0, P_FACE0 = 21, 42, 55
SIGN_COLUMNS = ("sequence_label", "label", "gloss", "sign")
ID_COLUMNS = ("sequence_id", "id", "clip")
SIGNER_COLUMNS = ("participant_id", "signer", "participant", "user_id")
# The competition's clips are 1280x720; x and y are normalised by width and height, so the aspect
# correction below needs the real frame size to put both hands and body in the same units.
WIDTH, HEIGHT, FPS = 1280, 720, 30


def _column(row, names):
    for name in names:
        if name in row and row[name] not in (None, ""):
            return row[name]
    raise KeyError(f"none of {names} in {sorted(row)}")


def _points(value, expected):
    """Accept the parquet column shapes seen in practice: N*3 floats, N dicts, or N structs."""
    if value is None:
        return np.full((expected, 3), np.nan, np.float32)
    array = np.asarray(value)
    if array.dtype != object and array.size == expected * 3:
        return array.astype(np.float32).reshape(expected, 3)
    rows = []
    for item in list(value):
        if isinstance(item, dict):
            rows.append([float(item.get("x", np.nan)), float(item.get("y", np.nan)), float(item.get("z", np.nan))])
        else:
            flat = np.asarray(item, dtype=np.float32).ravel()
            rows.append(flat[:3].tolist() if flat.size >= 3 else [np.nan, np.nan, np.nan])
    if len(rows) != expected:
        return np.full((expected, 3), np.nan, np.float32)
    return np.asarray(rows, np.float32)


def clip_points(row, width=WIDTH, height=HEIGHT):
    """One parquet row -> [T, 86, 3] in this project's point order."""
    left = _points(row.get("left_hand"), N_HAND)
    right = _points(row.get("right_hand"), N_HAND)
    pose = _points(row.get("pose"), 33)
    face = _points(row.get("face"), 468)
    # A hand that was not detected arrives as zeros or NaNs; both mean "missing".
    for hand in (left, right):
        hand[np.all(np.nan_to_num(hand, nan=0.0) == 0.0, axis=1)] = np.nan
    points = np.concatenate([left, right, pose[POSE], face[FACE]], axis=0).astype(np.float32)
    long_side = float(max(width, height))
    points[:, 0] *= width / long_side
    points[:, 1] *= height / long_side
    return points


# The competition's parquet files are long format: one row per landmark point, with `frame`, `type`,
# `landmark_index`, `x`, `y`, `z`. Group sizes are the full MediaPipe counts; this project keeps a
# subset of the pose and face points.
GROUPS = {"left_hand": (N_HAND, 0), "right_hand": (N_HAND, N_HAND), "pose": (33, P_POSE0), "face": (468, P_FACE0)}


def long_to_points(rows, width=WIDTH, height=HEIGHT):
    """Pivot long-format landmark rows into [T, 86, 3] in this project's point order."""
    frames = sorted({int(row["frame"]) for row in rows})
    position = {frame: index for index, frame in enumerate(frames)}
    count = len(frames)
    hands = np.full((count, 42, 3), np.nan, np.float32)
    pose = np.full((count, 33, 3), np.nan, np.float32)
    face = np.full((count, 468, 3), np.nan, np.float32)
    targets = {"left_hand": hands, "right_hand": hands, "pose": pose, "face": face}
    offsets = {"left_hand": 0, "right_hand": N_HAND, "pose": 0, "face": 0}
    for row in rows:
        group = row.get("type")
        target = targets.get(group)
        if target is None:
            continue
        index = row.get("landmark_index")
        if index is None:
            continue
        x, y, z = row.get("x"), row.get("y"), row.get("z")
        # A point that was not detected is written as null rather than omitted, so a null triple simply
        # stays missing instead of becoming a coordinate at the origin.
        if x is None or y is None or z is None:
            continue
        target[position[int(row["frame"])], offsets[group] + int(index)] = (float(x), float(y), float(z))
    for hand in (hands[:, :N_HAND], hands[:, N_HAND:]):
        hand[np.all(np.nan_to_num(hand, nan=0.0) == 0.0, axis=2)] = np.nan
    points = np.concatenate([hands[:, :N_HAND], hands[:, N_HAND:], pose[:, POSE], face[:, FACE]], axis=1).astype(np.float32)
    long_side = float(max(width, height))
    points[:, :, 0] *= width / long_side
    points[:, :, 1] *= height / long_side
    return points


def clip_from_table(rows, width=WIDTH, height=HEIGHT):
    """Accept either published layout: long rows (competition) or one row per frame (wide)."""
    if rows and "type" in rows[0] and "landmark_index" in rows[0]:
        return long_to_points(rows, width, height)
    return np.stack([clip_points(row, width, height) for row in rows], axis=0)


def hand_frames(points):
    return int(np.count_nonzero(np.any(np.isfinite(points[:, :42, :]), axis=(1, 2))))


def assign_splits(signers, val_fraction=0.1, test_fraction=0.1):
    """Signer-disjoint, deterministic: sorted participants dealt round-robin into three buckets."""
    ordered = sorted(signers)
    count = len(ordered)
    # A non-zero fraction always claims at least one signer, so a split is never silently empty; an
    # explicit zero claims none.
    def claim(fraction):
        if fraction <= 0 or count <= 2:
            return 0
        return max(1, round(count * fraction))
    n_val, n_test = claim(val_fraction), claim(test_fraction)
    n_train = max(0, count - n_val - n_test)
    split = {}
    for index, signer in enumerate(ordered):
        split[signer] = "train" if index < n_train else "val" if index < n_train + n_val else "test"
    return split


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--landmarks", required=True, help="directory holding <participant>/<sequence>.parquet")
    parser.add_argument("--meta", required=True, help="train.csv (or equivalent) from the competition download")
    parser.add_argument("--out", required=True, help="cache directory to write islr_<split>.npz into")
    parser.add_argument("--prefix", default="islr")
    parser.add_argument("--limit", type=int, default=0, help="import at most this many clips (0 = all)")
    parser.add_argument("--max-per-class", type=int, default=0, help="cap clips per label (0 = no cap)")
    parser.add_argument("--min-hand-frames", type=int, default=3, help="drop clips with fewer hand frames")
    parser.add_argument("--width", type=int, default=WIDTH, help="source frame width used for aspect correction")
    parser.add_argument("--height", type=int, default=HEIGHT, help="source frame height")
    parser.add_argument("--fps", type=float, default=FPS, help="frame rate the clips were recorded at")
    parser.add_argument("--check", action="store_true",
                        help="inspect one clip and report the layout, then stop (no import)")
    parser.add_argument("--val-fraction", type=float, default=0.1)
    parser.add_argument("--test-fraction", type=float, default=0.1)
    args = parser.parse_args()

    import pyarrow.parquet as pq  # imported here so --help works without it

    with open(args.meta, newline="") as handle:
        records = list(csv.DictReader(handle))
    if not records:
        raise SystemExit(f"{args.meta} has no rows")

    if args.check:
        # Inspect a clip that is actually present: a subset fetch leaves most of train.csv undownloaded,
        # and reporting on a file that is not there would be a confusing way to say the path is right.
        for record in records:
            sequence = str(_column(record, ID_COLUMNS))
            signer = str(_column(record, SIGNER_COLUMNS))
            candidate = os.path.join(args.landmarks, signer, f"{sequence}.parquet")
            if os.path.exists(candidate):
                path = candidate
                break
        else:
            raise SystemExit(f"no clip from {args.meta} exists under {args.landmarks} — check that "
                             "--landmarks points at train_landmark_files/")
        table = pq.read_table(path)
        columns = table.column_names
        rows = table.to_pylist()
        long_form = "type" in columns and "landmark_index" in columns
        report = {"clip": path, "columns": columns, "rows": table.num_rows,
                  "layout": "long (one row per point)" if long_form else "wide (one row per frame)"}
        if long_form:
            points = long_to_points(rows, args.width, args.height)
            frames = len(points)
            report["frames"] = frames
            report["groups"] = {
                "left_hand": int(np.isfinite(points[:, :21, :]).any(axis=(0, 2)).sum()),
                "right_hand": int(np.isfinite(points[:, 21:42, :]).any(axis=(0, 2)).sum()),
                "pose": int(np.isfinite(points[:, 42:55, :]).any(axis=(0, 2)).sum()),
                "face": int(np.isfinite(points[:, 55:, :]).any(axis=(0, 2)).sum()),
            }
            report["hand_frames"] = hand_frames(points)
            report["types"] = sorted({row.get("type") for row in rows if row.get("type")})
        else:
            for group, expected in (("left_hand", 21), ("right_hand", 21), ("pose", 33), ("face", 468)):
                if group not in columns:
                    report[group] = f"MISSING (expected {expected} points)"
                    continue
                preview = _points(rows[0].get(group), expected)
                report[group] = {"points": int(preview.shape[0]), "expected": expected,
                                 "finite": int(np.isfinite(preview).sum())}
        report["label"] = str(_column(record, SIGN_COLUMNS))
        report["frame_size"] = {"width": args.width, "height": args.height, "fps": args.fps}
        print(json.dumps(report, indent=2))
        if long_form:
            if not report["groups"]["face"] or not (report["groups"]["left_hand"] or report["groups"]["right_hand"]):
                raise SystemExit("long layout found but no face or hand points — check the type labels")
            if not report["hand_frames"]:
                raise SystemExit("no frame in this clip has a hand; check the coordinate convention")
            print("layout looks importable")
            return
        missing = [group for group in ("left_hand", "right_hand", "pose", "face") if group not in columns]
        if missing:
            raise SystemExit(f"unexpected layout: no {missing} column(s); the importer expects either the "
                             "competition's long landmark rows or per-frame landmark columns")
        print("layout looks importable")
        return

    rows = []
    per_class = defaultdict(int)
    missing = skipped = 0
    for record in records:
        sequence = str(_column(record, ID_COLUMNS))
        sign = str(_column(record, SIGN_COLUMNS)).strip().upper()
        signer = str(_column(record, SIGNER_COLUMNS))
        path = os.path.join(args.landmarks, signer, f"{sequence}.parquet")
        if not os.path.exists(path):
            missing += 1
            continue
        if args.max_per_class and per_class[sign] >= args.max_per_class:
            continue
        table = pq.read_table(path).to_pylist()
        if not table:
            skipped += 1
            continue
        points = clip_from_table(table, args.width, args.height)
        hands = hand_frames(points)
        if hands < args.min_hand_frames:
            skipped += 1
            continue
        rows.append({"key": f"{args.prefix}-{sequence}", "sign": sign, "signer": signer,
                     "sha256": "", "frames": int(len(points)), "hand_frames": hands,
                     "width": args.width, "height": args.height, "fps": args.fps,
                     "duration": round(len(points) / args.fps, 3),
                     "split": None, "points": points})
        per_class[sign] += 1
        if args.limit and len(rows) >= args.limit:
            break

    if not rows:
        raise SystemExit("no clips imported — check --landmarks/--meta point at the unzipped dataset")

    order = assign_splits({row["signer"] for row in rows}, args.val_fraction, args.test_fraction)
    for row in rows:
        row["split"] = order[row["signer"]]

    # A sign performed by signers who all land in one split cannot be trained on and validated, which
    # is easy to miss in a subset import; say so rather than letting a class quietly do nothing.
    splits_of = defaultdict(set)
    for row in rows:
        splits_of[row["sign"]].add(row["split"])
    single_split = sorted(sign for sign, where in splits_of.items() if len(where) == 1)

    os.makedirs(args.out, exist_ok=True)
    summary = {"prefix": args.prefix, "clips": len(rows), "classes": len(per_class), "missing_files": missing,
               "skipped": skipped, "signers": len(order), "width": args.width, "height": args.height, "fps": args.fps,
               "single_split_classes": len(single_split), "single_split_examples": single_split[:10]}
    for split in ("train", "val", "test"):
        chosen = sorted((row for row in rows if row["split"] == split), key=lambda row: row["key"])
        if not chosen:
            # A shard left behind by an earlier run with different split fractions would be merged as
            # if it belonged to this import, so remove it rather than leave a stale one.
            for suffix in (".npz", ".json"):
                stale = f"{args.out}/{args.prefix}_{split}{suffix}"
                if os.path.exists(stale):
                    os.remove(stale)
            continue
        chunks, offsets, meta = [], [0], []
        for row in chosen:
            chunks.append(row["points"].astype(np.float16))
            offsets.append(offsets[-1] + len(row["points"]))
            meta.append({key: row[key] for key in ("key", "sign", "signer", "sha256", "frames", "hand_frames",
                                                   "width", "height", "fps", "duration")})
        np.savez(f"{args.out}/{args.prefix}_{split}.npz",
                 pts=np.concatenate(chunks), offsets=np.array(offsets, np.int64))
        json.dump(meta, open(f"{args.out}/{args.prefix}_{split}.json", "w"))
        summary[f"{split}_clips"] = len(meta)
        summary[f"{split}_frames"] = int(offsets[-1])
        print(f"{split}: {len(meta)} clips, {offsets[-1]} frames")
    json.dump(summary, open(f"{args.out}/{args.prefix}_source.json", "w"), indent=2)
    if single_split:
        print(f"warning: {len(single_split)} signs appear in one split only (e.g. {single_split[0]}); "
              "they cannot be both trained and validated")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
