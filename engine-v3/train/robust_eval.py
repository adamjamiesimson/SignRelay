"""Score the frozen model on perturbed re-extractions of unseen test clips, per condition."""
import json, sys, collections, numpy as np
sys.path.insert(0, "."); sys.path.insert(0, "../pipeline")
import evaluate as ev
runs, cache, policy_path, protos_path, out = sys.argv[1:3] + sys.argv[3:6] if False else (sys.argv[1].split(","), sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5])
models = [ev.load_model(r)[0] for r in runs]; cls = json.load(open(f"{runs[0]}/classes.json")); C = len(cls["classes"])
mp = ev.sign_mapping(cls); pol = json.load(open(policy_path)); protos = np.load(protos_path)
split = sys.argv[6] if len(sys.argv) > 6 else "robust"
meta, L, E, ok = ev.infer(models, cache, split, no_face=True)
y, role = ev.labelled(meta, mp, C)
P = np.zeros_like(L); P[ok] = ev.softmax_T(L[ok], pol["temperature"])
st, i1 = ev.decide(P, E, pol, C, protos); st[~ok] = "no-sign"
top1 = np.where(ok, P[:, :C].argmax(1), -1); top5 = np.argsort(-P[:, :C], 1)[:, :5]
cond = np.array([m["key"].split("@")[-1] for m in meta])
rep = {}
for c in sorted(set(cond), key=lambda c: (c != "original", c)):
    m = cond == c
    acc = st[m] == "accepted"
    rep[c] = {"clips": int(m.sum()), "no_hands": int((~ok[m]).sum()), "top1": float((top1[m] == y[m]).mean()),
              "top5": float(((top5[m] == y[m, None]).any(1) & ok[m]).mean()),
              "accepted": float(acc.mean()), "accepted_precision": float((top1[m][acc] == y[m][acc]).mean()) if acc.any() else None}
    print(c, json.dumps({k: (round(v, 3) if isinstance(v, float) else v) for k, v in rep[c].items()}))
json.dump(rep, open(out, "w"), indent=1)
