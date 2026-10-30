"""Extract MediaPipe landmarks from PopSign ASL v1.0 clips (CC BY 4.0).

Uses the browser's own MediaPipe Tasks models and thresholds, so a model
trained on this output sees the representation SignRelay produces live.
Clips are fetched by byte range from the publisher's per-sign archives; only
landmarks are kept (compressed float16 arrays) and videos are deleted after
extraction. Selection is deterministic: per sign, the first --clips-per-signer
clips of each of the first --signers distinct signers in archive order.

Output per shard: <out>/<split>-<shard>.npz with ragged arrays concatenated
along time plus an index (sign, signer, member, frame offset, frame count).
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tempfile
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fetch_popsign_sample import BASE, get, members  # noqa: E402
from asl2000_conditions import FPS, MediaPipeTracker, decode  # noqa: E402


def frame_arrays(frame: dict) -> tuple[np.ndarray, np.ndarray]:
    """pose (33, 3: x, y, visibility) and hands (2, 21, 2) in MediaPipe's
    signer-left / signer-right label slots; NaN where not observed."""
    pose = np.full((33, 3), np.nan, dtype=np.float32)
    if len(frame["pose"]) == 33:
        pose[:] = [(p["x"], p["y"], p["visibility"]) for p in frame["pose"]]
    hands = np.full((2, 21, 2), np.nan, dtype=np.float32)
    for hand in frame["hands"]:
        slot = {"Left": 0, "Right": 1}.get(hand["handedness"])
        if slot is not None and np.isnan(hands[slot, 0, 0]):
            hands[slot] = [(p["x"], p["y"]) for p in hand["landmarks"]]
    return pose, hands


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    parser.add_argument("--split", default="train")
    parser.add_argument("--shard", type=int, default=0)
    parser.add_argument("--shards", type=int, default=1)
    parser.add_argument("--signers", type=int, default=24)
    parser.add_argument("--clips-per-signer", type=int, default=1)
    parser.add_argument("--max-headers", type=int, default=4000)
    parser.add_argument("--vision-models", type=Path, default=Path("public/vision/models"))
    args = parser.parse_args()
    listing = get(f"{BASE}/{args.split}/").decode("utf-8", "replace")
    signs = sorted(set(re.findall(r'href="([A-Za-z0-9_]+)\.tar"', listing)))
    mine = [sign for index, sign in enumerate(signs) if index % args.shards == args.shard]
    tracker = MediaPipeTracker(args.vision_models)
    poses, hands, index = [], [], []
    offset = 0
    with tempfile.TemporaryDirectory() as scratch:
        for sign in mine:
            url = f"{BASE}/{args.split}/{sign}.tar"
            chosen: dict[str, list[tuple[str, int, int]]] = {}
            try:
                for name, start, size in members(url, args.max_headers):
                    if not name.endswith(".mp4"):
                        continue
                    signer = Path(name).name.split("-")[0]
                    if signer not in chosen and len(chosen) >= args.signers:
                        continue
                    if len(chosen.setdefault(signer, [])) < args.clips_per_signer:
                        chosen[signer].append((name, start, size))
                    if len(chosen) >= args.signers and all(len(v) >= args.clips_per_signer for v in chosen.values()):
                        break
            except Exception as error:  # noqa: BLE001 - record and continue
                print(json.dumps({"sign": sign, "error": type(error).__name__}), flush=True)
                continue
            for signer, clips in chosen.items():
                for name, start, size in clips:
                    data = get(url, start, size)
                    if data[4:8] != b"ftyp":
                        continue
                    path = Path(scratch) / "clip.mp4"
                    path.write_bytes(data)
                    rgb, native_fps, _ = decode(path)
                    path.unlink()
                    if not rgb or not native_fps:
                        continue
                    count = int(len(rgb) / native_fps * FPS)
                    for k in range(count):
                        pose, hand = frame_arrays(tracker.frame(rgb[min(round(k / FPS * native_fps), len(rgb) - 1)], k * 1000.0 / FPS))
                        poses.append(pose)
                        hands.append(hand)
                    index.append({"sign": sign, "signer": signer, "member": name, "offset": offset, "frames": count})
                    offset += count
            print(json.dumps({"sign": sign, "signers": len(chosen), "clips": sum(len(v) for v in chosen.values())}), flush=True)
    tracker.close()
    args.output.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(args.output / f"{args.split}-{args.shard:02d}.npz",
                        pose=np.asarray(poses, dtype=np.float16).reshape(-1, 33, 3),
                        hands=np.asarray(hands, dtype=np.float16).reshape(-1, 2, 21, 2),
                        index=np.asarray(json.dumps(index)))
    print(json.dumps({"split": args.split, "shard": args.shard, "signs": len(mine), "clips": len(index), "frames": offset}))
    os._exit(0)  # MediaPipe 1.2 tasks crash in interpreter-shutdown finalisers


if __name__ == "__main__":
    main()
