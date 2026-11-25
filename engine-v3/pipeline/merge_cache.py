"""Add an imported shard set to the cache a training run reads, without losing what was there.

`train.py` reads exactly `cache/{train,val,test}.npz` plus their `.json` sidecars. A second dataset
therefore has to be merged in, and the merge has to be safe to run twice and reversible, because the
PopSign cache took hours to build and nobody wants to rebuild it to undo a mistake. So:

  * the first merge copies the existing arrays to `{split}.base.npz` / `{split}.base.json`;
  * every merge starts from `.base` when it exists, which makes re-running idempotent;
  * the merged files keep the base rows first, so a training log from before the merge still lines up
    with the first N clips;
  * a report records which sources went in and how many clips and frames each contributed.

Usage:
  python merge_cache.py --cache /path/to/cache --add islr
  python merge_cache.py --cache /path/to/cache --restore        # undo, keep the backups
"""
import argparse, json, os, shutil

import numpy as np
from points import N_POINTS

SPLITS = ("train", "val", "test")


def load_split(cache, stem):
    """Load `{stem}.npz` and `{stem}.json`, or None when either is absent."""
    npz = os.path.join(cache, f"{stem}.npz")
    meta_path = os.path.join(cache, f"{stem}.json")
    if not (os.path.exists(npz) and os.path.exists(meta_path)):
        return None
    archive = np.load(npz)
    return {"pts": archive["pts"], "offsets": archive["offsets"], "meta": json.load(open(meta_path))}


def merge_split(cache, add, split, init=False):
    current = load_split(cache, split)
    if current is None:
        if init:
            # No existing cache for this split: start one from the import, so a dataset can be trained
            # on its own before it is ever merged with anything.
            shard = load_split(cache, f"{add}_{split}")
            if shard is None:
                return None
            np.savez(os.path.join(cache, f"{split}.npz"), pts=shard["pts"], offsets=shard["offsets"].astype(np.int64))
            json.dump(shard["meta"], open(os.path.join(cache, f"{split}.json"), "w"))
            return {"base_clips": 0, "added_clips": len(shard["meta"]), "base_frames": 0,
                    "added_frames": int(shard["offsets"][-1]), "total_clips": len(shard["meta"]),
                    "total_frames": int(shard["offsets"][-1]), "classes": len({row["sign"] for row in shard["meta"]})}
        # A cache may hold only some splits; a missing one is reported by main, not fatal here.
        return None
    backup = load_split(cache, f"{split}.base")
    # A backup already present means this cache has been merged before: start from the untouched
    # original so running the merge twice gives the same result instead of appending twice.
    base = backup or current
    extra = load_split(cache, f"{add}_{split}")
    if extra is None:
        return None
    for name, part in (("base", base), ("imported", extra)):
        shape = part["pts"].shape
        if shape[1] != N_POINTS:
            raise SystemExit(f"{name} {split} has {shape[1]} points per frame, expected {N_POINTS}")
    base_keys = {row["key"] for row in base["meta"]}
    duplicate = [row["key"] for row in extra["meta"] if row["key"] in base_keys]
    if duplicate:
        raise SystemExit(f"{len(duplicate)} imported keys already exist in {split}, e.g. {duplicate[0]}")

    # Preserve the originals once, before anything is overwritten.
    if backup is None:
        shutil.copyfile(os.path.join(cache, f"{split}.npz"), os.path.join(cache, f"{split}.base.npz"))
        shutil.copyfile(os.path.join(cache, f"{split}.json"), os.path.join(cache, f"{split}.base.json"))

    pts = np.concatenate([base["pts"], extra["pts"]], axis=0)
    offsets = np.concatenate([base["offsets"], extra["offsets"][1:] + int(base["offsets"][-1])])
    meta = list(base["meta"]) + list(extra["meta"])
    np.savez(os.path.join(cache, f"{split}.npz"), pts=pts, offsets=offsets.astype(np.int64))
    json.dump(meta, open(os.path.join(cache, f"{split}.json"), "w"))
    return {"base_clips": len(base["meta"]), "added_clips": len(extra["meta"]),
            "base_frames": int(base["offsets"][-1]), "added_frames": int(extra["offsets"][-1]),
            "total_clips": len(meta), "total_frames": int(offsets[-1]),
            "classes": len({row["sign"] for row in meta})}


def restore(cache):
    for split in SPLITS:
        npz, meta = (os.path.join(cache, f"{split}{suffix}") for suffix in (".base.npz", ".base.json"))
        if os.path.exists(npz) and os.path.exists(meta):
            shutil.copyfile(npz, os.path.join(cache, f"{split}.npz"))
            shutil.copyfile(meta, os.path.join(cache, f"{split}.json"))
            print(f"restored {split}")
        else:
            print(f"no backup for {split}, left alone")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache", required=True)
    parser.add_argument("--add", default=None, help="prefix written by import_islr.py, e.g. islr")
    parser.add_argument("--restore", action="store_true")
    parser.add_argument("--init", action="store_true",
                        help="seed an empty cache from the import instead of merging into an existing one")
    args = parser.parse_args()
    if args.restore:
        restore(args.cache)
        return
    if not args.add:
        raise SystemExit("pass --add <prefix> or --restore")
    report = {"cache": args.cache, "added": args.add, "splits": {}}
    for split in SPLITS:
        result = merge_split(args.cache, args.add, split, init=args.init)
        if result:
            report["splits"][split] = result
            print(f"{split}: {result['base_clips']} + {result['added_clips']} clips -> {result['total_clips']}")
    if not report["splits"]:
        raise SystemExit(f"nothing to merge: no {args.add}_<split>.npz in {args.cache}")
    json.dump(report, open(os.path.join(args.cache, "merge-report.json"), "w"), indent=2)


if __name__ == "__main__":
    main()
