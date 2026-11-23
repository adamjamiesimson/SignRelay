"""Engine V3 evaluation and open-set calibration.

Inference helpers, metrics, temperature fitting and decision-policy selection.

  # fit temperature + rejection policy on VALIDATION signers and calibration-only unknown signs
  python evaluate.py calibrate --run runs/X --cache CACHE --out runs/X/policy.json
  # full report on validation (allowed any time)
  python evaluate.py report --run runs/X --cache CACHE --split val --policy runs/X/policy.json --out report-val.json
  # sealed test: only after the model and policy are frozen; refuses to run twice for a frozen id
  python evaluate.py report ... --split test --sealed-test --freeze-id <id>
"""
from __future__ import annotations

import argparse, collections, json, math, os, sys, time
import numpy as np
import torch
import torch.nn.functional as F

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE); sys.path.insert(0, os.path.join(HERE, "..", "pipeline"))
from v3model import SignModel, prepare_clip  # noqa: E402
import labels  # noqa: E402


def load_model(run, which="best.pt"):
    cfg = json.load(open(f"{run}/config.json")); cls = json.load(open(f"{run}/classes.json"))
    m = SignModel(len(cls["classes"]) + 1, d=cfg["dim"], depth=cfg["depth"], kind=cfg["kind"])
    m.load_state_dict(torch.load(f"{run}/{which}", weights_only=False)["model"]); m.eval()
    return m, cfg, cls


def sign_mapping(cls_json):
    policy = labels.load_policy()
    policy["validation_merges"] = cls_json.get("validation_merges", {})
    signs = json.load(open(os.path.join(HERE, "..", "vocabulary", "popsign_signs.json")))
    classes, mapping = labels.build(signs, policy)
    assert classes == cls_json["classes"], "class list drifted from the trained model"
    return mapping


@torch.no_grad()
def infer(models, cache, split, no_face=False, bs=256):
    """Returns meta rows, logits [N, C+1] (NaN rows for no-sign clips), embeddings [N, D], prepared mask."""
    z = np.load(f"{cache}/{split}.npz"); meta = json.load(open(f"{cache}/{split}.json")); offs = z["offsets"]; pts = z["pts"]
    preps = []
    for i in range(len(meta)):
        c = pts[offs[i]:offs[i + 1]].astype(np.float32)
        if no_face: c[:, 55:] = np.nan
        preps.append(prepare_clip(c))
    ok = np.array([p is not None for p in preps])
    n_out = models[0].head.out_features; D = models[0].head.in_features
    L = np.full((len(meta), n_out), np.nan, np.float32); E = np.full((len(meta), D * len(models)), np.nan, np.float32)
    idx = np.nonzero(ok)[0]
    for s in range(0, len(idx), bs):
        b = idx[s:s + bs]
        x = torch.from_numpy(np.stack([preps[i][0] for i in b])); v = torch.from_numpy(np.stack([preps[i][1] for i in b]))
        f = torch.from_numpy(np.stack([preps[i][2] for i in b]))
        ls, es = [], []
        for m in models:
            e = m.embed(x, v, f); ls.append(F.log_softmax(m.head(e), -1)); es.append(F.normalize(e, dim=-1))
        # ensemble = mean of log-probabilities (a single model returns its log-softmax, monotone in logits)
        L[b] = torch.stack(ls).mean(0).numpy(); E[b] = F.normalize(torch.cat(es, -1), dim=-1).numpy()
    return meta, L, E, ok


def softmax_T(L, T):
    z = L / T; z = z - z.max(1, keepdims=True); e = np.exp(z); return e / e.sum(1, keepdims=True)


def fit_temperature(L, y):
    best = (1e9, 1.0)
    for T in np.exp(np.linspace(np.log(0.3), np.log(5), 120)):
        P = softmax_T(L, T); nll = -np.log(P[np.arange(len(y)), y] + 1e-12).mean()
        if nll < best[0]: best = (nll, float(T))
    return best[1]


def ece(conf, correct, bins=15):
    e, edges = 0.0, np.linspace(0, 1, bins + 1)
    for a, b in zip(edges[:-1], edges[1:]):
        m = (conf > a) & (conf <= b)
        if m.any(): e += m.mean() * abs(conf[m].mean() - correct[m].mean())
    return float(e)


def decide(P, E, policy, C, protos=None):
    """Vectorised mirror of web/decision.mjs:decide. Returns (status array, top1 index)."""
    known = P[:, :C]; i1 = known.argmax(1); srt = np.sort(known, 1); p1, p2 = srt[:, -1], srt[:, -2]
    st = np.full(len(P), "accepted", dtype=object)
    unk = P[:, C] >= policy["max_unknown"]
    unc = (p1 < policy["min_top1"]) | ((p1 - p2) < (policy.get("min_margin") if policy.get("min_margin") is not None else -1))
    st[unc] = "uncertain"
    if policy.get("min_proto") is not None and protos is not None:
        cos = (E * protos[i1]).sum(1); st[(cos < policy["min_proto"]) & ~unc] = "unknown"
    st[unk] = "unknown"
    return st, i1


def open_set_metrics(st, i1, y_known, is_unknown, nosign):
    st = st.copy(); st[nosign] = "no-sign"
    K = ~is_unknown
    acc = st == "accepted"
    correct = acc & K & (i1 == y_known)
    return {
        "known_clips": int(K.sum()), "unknown_clips": int(is_unknown.sum()),
        "known_coverage": float(acc[K].mean()) if K.any() else None,
        "known_accepted_precision": float(correct[K].sum() / max(acc[K].sum(), 1)),
        "known_correct_accept_rate": float(correct[K].mean()) if K.any() else None,
        "known_wrong_accept_rate": float((acc & K & (i1 != y_known))[K].mean()) if K.any() else None,
        "unknown_false_accept_rate": float(acc[is_unknown].mean()) if is_unknown.any() else None,
        "abstention_rate_known": float((~acc)[K].mean()) if K.any() else None,
        "status_counts_known": dict(collections.Counter(st[K])), "status_counts_unknown": dict(collections.Counter(st[is_unknown])),
    }


def labelled(meta, mapping, C):
    y = np.full(len(meta), -1); role = np.empty(len(meta), dtype=object)
    for i, m in enumerate(meta):
        # external cohorts: fingerspelling windows -> non-vocabulary motion; ASL Citizen OOV -> unknown sign
        t = mapping[m["sign"]] if m["sign"] in mapping else {"__fingerspelling__": "nonvocab_motion", "__oov__": "unknown_external"}[m["sign"]]
        if isinstance(t, (int, np.integer)): y[i] = t; role[i] = "known"
        else: role[i] = t
    return y, role


def calibrate(a):
    models = [load_model(r)[0] for r in a.run]
    cls = json.load(open(f"{a.run[0]}/classes.json")); C = len(cls["classes"]); mapping = sign_mapping(cls)
    meta, L, E, ok = infer(models, a.cache, "val", a.no_face)
    y, role = labelled(meta, mapping, C)
    kn = (role == "known") & ok
    T = fit_temperature(L[kn], y[kn])
    # calibration-only unknown signs: their validation-signer clips plus their training-split clips
    # (those signs were never used in training, so every clip of them is unseen).
    mt, Lt, Et, okt = infer(models, a.cache, "train", a.no_face)
    _, rt = labelled(mt, mapping, C)
    cu = np.concatenate([L[(role == "unknown_cal") & ok], Lt[(rt == "unknown_cal") & okt]])
    cuE = np.concatenate([E[(role == "unknown_cal") & ok], Et[(rt == "unknown_cal") & okt]])
    protos = np.load(a.prototypes) if a.prototypes else None
    Pk, Pu = softmax_T(L[kn], T), softmax_T(cu, T)
    yk = y[kn]
    best, grid = None, []
    su_p1 = Pu[:, :C].max(1)
    cos_u = (cuE * protos[Pu[:, :C].argmax(1)]).sum(1) if protos is not None else None
    # thresholds at quantiles of the unknown-calibration score distributions (fine at the strict end)
    qs = [0, .5, .6, .7, .75, .8, .85, .9, .93, .95, .97, .99]
    for mu in [0.3, 0.5, 1.01]:
        for mt1 in sorted(set(float(np.quantile(su_p1, q)) if q else 0.0 for q in qs)):
            for mp in ([None] if protos is None else [None] + sorted(set(float(np.quantile(cos_u, q)) for q in qs[1:]))):
                pol = {"temperature": T, "max_unknown": mu, "min_top1": mt1, "min_margin": None, "min_proto": mp}
                sk, ik = decide(Pk, E[kn], pol, C, protos); su, _ = decide(Pu, cuE, pol, C, protos)
                acc_k = sk == "accepted"; corr = (acc_k & (ik == yk)).mean(); wrong = (acc_k & (ik != yk)).mean()
                far = (su == "accepted").mean()
                util = corr - wrong  # maximise correct minus wrong accepts subject to the FAR cap
                grid.append({**pol, "correct": float(corr), "wrong": float(wrong), "far": float(far), "utility": float(util)})
                if far <= a.max_far and (best is None or util > best["utility"]): best = grid[-1]
    json.dump(grid, open(a.out.replace(".json", "-grid.json"), "w"))
    print("n known", int(kn.sum()), "n unknown-cal", len(cu), "far range", min(g["far"] for g in grid), max(g["far"] for g in grid))
    if best is None: raise SystemExit("no operating point satisfies max_far")
    policy = {k: best[k] for k in ("temperature", "max_unknown", "min_top1", "min_margin", "min_proto")}
    policy.update(min_hand_frames=3, selection={"objective": "max(correct - wrong) s.t. unknown accept rate <= max_far", "max_far": a.max_far,
                  "fit_on": "validation signers (known) + calibration-only unknown signs (val+train clips)",
                  "val_point": {k: best[k] for k in ("correct", "wrong", "far")}, "n_known": int(kn.sum()), "n_unknown_cal": int(len(cu))})
    json.dump(policy, open(a.out, "w"), indent=1)
    json.dump(grid, open(a.out.replace(".json", "-grid.json"), "w"))
    print(json.dumps(policy, indent=1))


def report(a):
    if a.split in ("test", "h2_popsign", "aslc_val") and not a.sealed_test:
        raise SystemExit(f"{a.split} is sealed; pass --sealed-test only after freezing")
    if a.sealed_test:
        lockf = os.path.join(os.path.dirname(a.out), f"SEALED-{a.freeze_id}.lock")
        if os.path.exists(lockf): raise SystemExit(f"sealed test already run for {a.freeze_id}")
        open(lockf, "w").write(json.dumps({"runs": a.run, "policy": a.policy, "at": time.time()}))
    models = [load_model(r)[0] for r in a.run]
    cls = json.load(open(f"{a.run[0]}/classes.json")); classes = cls["classes"]; C = len(classes); mapping = sign_mapping(cls)
    t0 = time.time(); meta, L, E, ok = infer(models, a.cache, a.split, a.no_face); dt = time.time() - t0
    y, role = labelled(meta, mapping, C)
    policy = json.load(open(a.policy)) if a.policy else {"temperature": 1.0, "max_unknown": 1.01, "min_top1": 0, "min_margin": None, "min_proto": None}
    protos = np.load(a.prototypes) if a.prototypes else None
    K = role == "known"
    P = np.zeros_like(L); P[ok] = softmax_T(L[ok], policy["temperature"])
    Pk = P[:, :C]
    top1 = np.where(ok, Pk.argmax(1), -1)
    top5 = np.argsort(-Pk, 1)[:, :5]
    c1 = (top1 == y) & K; c5 = (top5 == y[:, None]).any(1) & ok & K
    # per class
    per = []
    for c in range(C):
        m = K & (y == c); pm = K & (top1 == c)
        per.append({"class": classes[c], "n": int(m.sum()), "recall": float(c1[m].mean()) if m.any() else None,
                    "precision": float((y[pm] == c).mean()) if pm.any() else None,
                    "signers": len({meta[i]["signer"] for i in np.nonzero(m)[0]})})
    covered = [p for p in per if p["n"] > 0]
    conf = collections.Counter((classes[y[i]], classes[top1[i]]) for i in np.nonzero(K & ok & ~c1)[0])
    signer = collections.defaultdict(list)
    for i in np.nonzero(K)[0]: signer[meta[i]["signer"]].append(bool(c1[i]))
    st, i1 = decide(P, E, policy, C, protos) if ok.any() else (None, None)
    unk_roles = {"val": ["unknown_cal"], "test": ["unknown_test"], "train": [], "fs_test": ["nonvocab_motion"],
                 "aslc": ["unknown_external"], "h2_popsign": ["unknown_test"], "aslc_val": ["unknown_external"]}.get(a.split, [])
    U = np.isin(role, unk_roles) if unk_roles else np.zeros(len(meta), bool)
    sel = K | U
    osm = open_set_metrics(st[sel], i1[sel], y[sel], U[sel], ~ok[sel])
    pt = Pk.max(1)
    rep = {
        "split": a.split, "runs": a.run, "policy": policy, "inference_seconds": dt, "clips_per_second": len(meta) / dt,
        "trained_labels": C, "labels_with_eval_coverage": len(covered),
        "known_clips": int(K.sum()), "no_sign_known_clips": int((K & ~ok).sum()),
        "top1": float(c1[K].mean()) if K.any() else None, "top5": float(c5[K].mean()) if K.any() else None,
        "macro_recall": float(np.mean([p["recall"] for p in covered])) if covered else None,
        "ece_top1": ece(pt[K & ok], c1[K & ok].astype(float)) if (K & ok).any() else None,
        "signers": {s: {"n": len(v), "top1": float(np.mean(v))} for s, v in sorted(signer.items())},
        "weakest_classes": sorted(covered, key=lambda p: (p["recall"], -p["n"]))[:40],
        "top_confusions": [{"true": t, "pred": p, "count": n} for (t, p), n in conf.most_common(60)],
        "open_set": osm, "per_class": per,
        "unknown_signs_evaluated": sorted({meta[i]["sign"] for i in np.nonzero(U)[0]}),
    }
    json.dump(rep, open(a.out, "w"), indent=1)
    np.savez_compressed(a.out.replace(".json", "-raw.npz"), logprobs=L, emb=E, ok=ok, y=y, role=role.astype(str),
                        keys=np.array([m["key"] for m in meta]), signer=np.array([m["signer"] for m in meta]))
    print(json.dumps({k: rep[k] for k in ("split", "trained_labels", "labels_with_eval_coverage", "known_clips", "no_sign_known_clips",
                                          "top1", "top5", "macro_recall", "ece_top1")}, indent=1))
    print(json.dumps(rep["open_set"], indent=1))


def prototypes(a):
    models = [load_model(r)[0] for r in a.run]
    cls = json.load(open(f"{a.run[0]}/classes.json")); C = len(cls["classes"]); mapping = sign_mapping(cls)
    meta, L, E, ok = infer(models, a.cache, "train", a.no_face)
    y, role = labelled(meta, mapping, C)
    P = np.zeros((C, E.shape[1]), np.float32)
    for c in range(C):
        m = (y == c) & ok
        v = E[m].mean(0); P[c] = v / max(np.linalg.norm(v), 1e-6)
    np.save(a.out, P); print("prototypes", P.shape)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["calibrate", "report", "prototypes"])
    ap.add_argument("--run", nargs="+", required=True); ap.add_argument("--cache", required=True)
    ap.add_argument("--out", required=True); ap.add_argument("--split", default="val")
    ap.add_argument("--policy"); ap.add_argument("--prototypes"); ap.add_argument("--no-face", action="store_true")
    ap.add_argument("--max-far", type=float, default=0.10)
    ap.add_argument("--sealed-test", action="store_true"); ap.add_argument("--freeze-id", default="")
    a = ap.parse_args()
    {"calibrate": calibrate, "report": report, "prototypes": prototypes}[a.cmd](a)
