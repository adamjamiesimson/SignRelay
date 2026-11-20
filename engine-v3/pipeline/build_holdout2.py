"""Build holdout-2 caches from extracted landmarks (no model involved).

h2_popsign: PopSign test round-1 clips only (plan-F-test-r1), never the v3.0-exposed round 0.
aslc_val:   ASL Citizen validation-split signers (evaluation only).
"""
import json, sys, glob, os
import numpy as np
from build_cache import gather

def main(lmdir, plan_f, out):
    os.makedirs(out, exist_ok=True)
    f_files = {r["file"] for r in json.load(open(plan_f))}
    status = {}
    for fn in glob.glob(f"{lmdir}/status-*.jsonl"):
        for line in open(fn):
            r = json.loads(line); status[r["key"]] = r
    for name, sel in (("h2_popsign", lambda r: r["split"] == "test" and r["file"] in f_files),
                      ("aslc_val", lambda r: r["split"] == "aslc_val")):
        rows = sorted((r for r in status.values() if sel(r) and r["status"] == "ok"), key=lambda r: r["key"])
        chunks, offs, meta = [], [0], []
        for r in rows:
            p = gather(np.load(f"{lmdir}/{r['key']}.npz")); chunks.append(p.astype(np.float16)); offs.append(offs[-1] + len(p))
            meta.append({k: r.get(k) for k in ("key", "sign", "signer", "sha256", "frames", "hand_frames", "width", "height", "aslc_gloss", "role")})
        np.savez(f"{out}/{name}.npz", pts=np.concatenate(chunks), offsets=np.array(offs, np.int64))
        json.dump(meta, open(f"{out}/{name}.json", "w"))
        print(name, len(meta), "clips", len({m['signer'] for m in meta}), "signers")

if __name__ == "__main__":
    main(*sys.argv[1:4])
