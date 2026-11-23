"""Validation-only alias resolution for the pre-registered merge candidates (vocabulary/policy.json).

For each candidate pair (a, b) report how often validation clips of a are predicted as b and vice
versa, alongside each class's own recall. A pair is proposed for merging only if BOTH directions
are confused at >= 30 % (the model cannot tell them apart in either direction); the final call is
recorded with a linguistic note in policy.json under "validation_merges" before any test result.
"""
import json, sys, itertools, numpy as np
sys.path.insert(0, "."); sys.path.insert(0, "../pipeline")
import evaluate as ev, labels

runs = sys.argv[1:]
models = [ev.load_model(r)[0] for r in runs]; cls = json.load(open(f"{runs[0]}/classes.json")); C = len(cls["classes"])
mp = ev.sign_mapping(cls)
meta, L, E, ok = ev.infer(models, "/home/user/data/cache", "val", no_face=True)
y, role = ev.labelled(meta, mp, C)
pred = np.where(ok, L[:, :C].argmax(1), -1)
pol = labels.load_policy(); idx = {c: i for i, c in enumerate(cls["classes"])}
out = []
for group in pol["merge_candidates_resolved_on_validation_only"]:
    names = [labels.canonical(s, pol) for s in group]
    names = [n for n in dict.fromkeys(names) if n in idx]
    for a, b in itertools.combinations(names, 2):
        ia, ib = idx[a], idx[b]; ma, mb = (y == ia) & (role == "known"), (y == ib) & (role == "known")
        r = {"a": a, "b": b, "n_a": int(ma.sum()), "n_b": int(mb.sum()),
             "recall_a": float((pred[ma] == ia).mean()) if ma.any() else None, "recall_b": float((pred[mb] == ib).mean()) if mb.any() else None,
             "a_as_b": float((pred[ma] == ib).mean()) if ma.any() else None, "b_as_a": float((pred[mb] == ia).mean()) if mb.any() else None}
        r["propose_merge"] = bool(r["a_as_b"] is not None and r["b_as_a"] is not None and r["a_as_b"] >= 0.3 and r["b_as_a"] >= 0.3)
        out.append(r); print(json.dumps(r))
json.dump(out, open("/home/user/data/alias_check.json", "w"), indent=1)
