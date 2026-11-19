"""Gather extracted .npz landmark files into compact per-split arrays.

Output (cache/<split>.npz): pts float16 [sumT, 86, 3] (NaN = missing), offsets
int64 [N+1], and a JSON sidecar with one row per clip (key, sign, signer, sha256,
frames, hand_frames, width, height). Exact duplicate recordings (same sha256) are
dropped everywhere after the first occurrence and listed with the reason.
"""
import json, os, sys, glob
import numpy as np
from points import POSE, FACE, N_POINTS

def gather(z):
    w, h = float(z["width"]), float(z["height"]); L = max(w, h)
    hands = z["hands"].astype(np.float32).reshape(-1, 42, 3)
    pose = z["pose"].astype(np.float32)[:, POSE, :3]
    face = z["face"].astype(np.float32)[:, FACE, :]
    p = np.concatenate([hands, pose, face], 1)
    p[..., 0] *= w / L; p[..., 1] *= h / L
    # pose points with low visibility are treated as missing (same rule in the browser)
    vis = z["pose"].astype(np.float32)[:, POSE, 3]
    p[:, 42:42 + len(POSE)][vis < 0.5] = np.nan
    return p

def main(lmdir, outdir, splits=("train", "val", "test")):
    os.makedirs(outdir, exist_ok=True)
    status = {}
    for f in glob.glob(f"{lmdir}/status-*.jsonl"):
        for line in open(f):
            r = json.loads(line); status[r["key"]] = r
    seen_sha, excluded = {}, []
    for split in splits:
        rows = sorted((r for r in status.values() if r["split"] == split), key=lambda r: r["key"])
        meta, chunks, offs = [], [], [0]
        for r in rows:
            if r["status"] != "ok":
                excluded.append({"key": r["key"], "reason": r.get("reason", "error")}); continue
            if r["sha256"] in seen_sha:
                excluded.append({"key": r["key"], "reason": f"duplicate of {seen_sha[r['sha256']]}"}); continue
            seen_sha[r["sha256"]] = r["key"]
            p = gather(np.load(f"{lmdir}/{r['key']}.npz"))
            chunks.append(p.astype(np.float16)); offs.append(offs[-1] + len(p))
            meta.append({k: r[k] for k in ("key", "sign", "signer", "sha256", "frames", "hand_frames", "width", "height", "fps", "duration")})
        if not meta: continue
        np.savez(f"{outdir}/{split}.npz", pts=np.concatenate(chunks), offsets=np.array(offs, np.int64))
        json.dump(meta, open(f"{outdir}/{split}.json", "w"))
        print(split, len(meta), "clips", offs[-1], "frames")
    json.dump(excluded, open(f"{outdir}/excluded.json", "w"), indent=0)
    print("excluded", len(excluded))

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], tuple(sys.argv[3:]) or ("train", "val", "test"))
