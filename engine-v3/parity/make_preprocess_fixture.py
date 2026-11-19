"""Fixture for preprocess.test.mjs: real raw landmark clips + Python reference outputs."""
import json, sys, os
import numpy as np
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "train"))
from v3model import prepare_clip, resample_to_15hz
cache, out = sys.argv[1], sys.argv[2]
z = np.load(f"{cache}/train.npz"); o = z["offsets"]; rng = np.random.default_rng(1); cases = []
for i in range(0, min(len(o) - 1, 400), 13):
    c = z["pts"][o[i]:o[i + 1]].astype(np.float32)
    p = prepare_clip(c)
    ts = np.cumsum(rng.uniform(40, 160, len(c))); ts -= ts[0]
    r = resample_to_15hz(ts, c)
    enc = lambda a: [None if not np.isfinite(v) else float(v) for v in a.ravel()]
    cases.append({"raw": enc(c), "T": len(c), "prep": None if p is None else {"x": p[0].ravel().tolist(), "valid": p[1].ravel().tolist(), "fmask": p[2].tolist()},
                  "ts": ts.tolist(), "resampled": enc(r), "R": len(r)})
json.dump(cases, open(out, "w")); print(len(cases), "cases")
