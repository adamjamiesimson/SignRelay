"""Train an Engine V3 candidate on cached PopSign landmarks (CPU, resumable).

Usage:
  python train.py --cache /home/user/data/cache --out runs/<name> [--kind convformer|gru] [--epochs N]
Outputs in --out: ckpt.pt (latest, resumable), best.pt (best validation top-1),
log.jsonl (per epoch), config.json, classes.json.
Validation uses ONLY the validation signers; the test split is never read here.
"""
from __future__ import annotations

import argparse, json, math, os, sys, time
import numpy as np
import torch
import torch.nn.functional as F

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE); sys.path.insert(0, os.path.join(HERE, "..", "pipeline"))
from v3model import SignModel, prepare_clip, sign_span, resample_index, resample_to_15hz, TMAX  # noqa: E402
from points import MIRROR, N_POINTS  # noqa: E402
import labels  # noqa: E402


def load_split(cache, split, mapping):
    z = np.load(f"{cache}/{split}.npz"); meta = json.load(open(f"{cache}/{split}.json"))
    pts, offs = z["pts"], z["offsets"]
    clips = [pts[offs[i]:offs[i + 1]] for i in range(len(meta))]
    y = [mapping[m["sign"]] for m in meta]
    return clips, y, meta


# ---------------------------------------------------------------- augmentation (training only)
def augment(seg, rng):
    seg = seg.astype(np.float32).copy()
    n = len(seg)
    # temporal: random speed 0.7-1.4 and +-2 frame jitter of the span edges
    f = rng.uniform(0.7, 1.4)
    m = max(4, int(round(n / f)))
    idx = np.clip(np.floor(np.arange(m) * (n - 1) / max(m - 1, 1) + rng.uniform(-0.5, 0.5, m) + 0.5), 0, n - 1).astype(int)
    idx = np.sort(idx)
    seg = seg[idx]
    # low camera frame rate: observe at an irregular 5-14 Hz, then interpolate back to 15 Hz
    # exactly as the browser camera path does (web/preprocess.mjs:resampleTo15Hz)
    if rng.random() < 0.35 and len(seg) > 4:
        dur = (len(seg) - 1) * 1000 / 15; hz = rng.uniform(5, 14)
        obs = np.cumsum(rng.uniform(0.6, 1.4, int(dur / 1000 * hz) + 2) * 1000 / hz); obs = obs[obs <= dur]
        obs = np.concatenate([[0.0], obs])
        src = seg[np.clip(np.round(obs * 15 / 1000).astype(int), 0, len(seg) - 1)]
        seg = resample_to_15hz(obs, src, 0.0, obs[-1])
    a = rng.integers(0, 3); b = len(seg) - rng.integers(0, 3)
    if b - a >= 4: seg = seg[a:b]
    # mirror (left/right signer) with p=0.5
    if rng.random() < 0.5:
        seg = seg[:, MIRROR]
        seg[..., 0] = -seg[..., 0]
        seg[..., 2] = seg[..., 2]  # z unchanged
    # spatial affine on x,y about the clip centroid
    xy = seg[..., :2]
    cen = np.nanmean(xy.reshape(-1, 2), 0)
    if not np.all(np.isfinite(cen)): cen = np.zeros(2, np.float32)
    th = np.deg2rad(rng.uniform(-15, 15)); sc = rng.uniform(0.8, 1.2); sh = rng.uniform(-0.15, 0.15)
    A = np.array([[math.cos(th), -math.sin(th)], [math.sin(th), math.cos(th)]]) @ np.array([[1, sh], [0, 1]]) * sc
    A = A * np.array([[rng.uniform(0.9, 1.1)], [1.0]])  # aspect jitter
    seg[..., :2] = (xy - cen) @ A.T.astype(np.float32) + cen + rng.uniform(-0.1, 0.1, 2).astype(np.float32)
    seg[..., 2] *= sc
    # landmark dropout: whole face/pose for the clip, a hand for a contiguous run, random frames
    if rng.random() < 0.1: seg[:, 55:] = np.nan
    if rng.random() < 0.05: seg[:, 42:55] = np.nan
    if rng.random() < 0.2:
        h = rng.integers(0, 2); L = len(seg); s = rng.integers(0, L); e = min(L, s + rng.integers(1, max(2, L // 3)))
        seg[s:e, h * 21:(h + 1) * 21] = np.nan
    if rng.random() < 0.3:
        drop = rng.random(len(seg)) < 0.1
        seg[drop] = np.nan
    return seg


def batchify(items):
    xs, vs, ms = zip(*items)
    return torch.from_numpy(np.stack(xs)), torch.from_numpy(np.stack(vs)), torch.from_numpy(np.stack(ms))


def prepared(clips):
    out = []
    for c in clips:
        p = prepare_clip(c.astype(np.float32))
        out.append(p)
    return out


@torch.no_grad()
def predict(model, prepped, bs=256):
    model.eval(); logits, embs = [], []
    device = next(model.parameters()).device
    ok = [i for i, p in enumerate(prepped) if p is not None]
    with torch.no_grad():
        for i in range(0, len(ok), bs):
            x, v, m = batchify([prepped[j] for j in ok[i:i + bs]])
            x, v, m = x.to(device), v.to(device), m.to(device)
            e = model.embed(x, v, m); logits.append(model.head(e).cpu()); embs.append(F.normalize(e, dim=-1).cpu())
    L = torch.cat(logits).numpy() if logits else np.zeros((0, model.head.out_features))
    E = torch.cat(embs).numpy() if embs else np.zeros((0, model.head.in_features))
    return ok, L, E


def resolve_device(requested="auto"):
    """Pick the fastest available device; state dicts are always saved on the CPU so a run started on a
    GPU can be resumed on a laptop."""
    if requested != "auto":
        return torch.device(requested)
    if torch.cuda.is_available():
        return torch.device("cuda")
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", required=True); ap.add_argument("--out", required=True)
    ap.add_argument("--kind", default="convformer"); ap.add_argument("--dim", type=int, default=192)
    ap.add_argument("--depth", type=int, default=2); ap.add_argument("--epochs", type=int, default=60)
    ap.add_argument("--bs", type=int, default=64); ap.add_argument("--lr", type=float, default=2e-3)
    ap.add_argument("--wd", type=float, default=0.05); ap.add_argument("--smooth", type=float, default=0.1)
    ap.add_argument("--unknown-weight", type=float, default=0.3); ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--no-face", action="store_true", help="ablation: drop face points at train and eval")
    ap.add_argument("--threads", type=int, default=4); ap.add_argument("--late-drop-epoch", type=int, default=0)
    ap.add_argument("--device", default="auto", help="auto, cpu, cuda or mps")
    ap.add_argument("--policy", default=None)
    ap.add_argument("--vocabulary", default=None,
                    help="signs to keep as classes in addition to the cache (default: the PopSign list). "
                         "Pass a JSON list, or an empty list, when training on a different dataset alone.")
    ap.add_argument("--fs-negatives", action="store_true", help="add FSBoard fingerspelling windows as UNKNOWN")
    ap.add_argument("--balance", type=float, default=0.0,
                    help="class-balanced loss: weight_c = (median_count / count_c) ** balance (0 = off, 0.5 = inverse sqrt)")
    a = ap.parse_args()
    torch.set_num_threads(a.threads); torch.manual_seed(a.seed); rng = np.random.default_rng(a.seed)
    os.makedirs(a.out, exist_ok=True)

    policy = labels.load_policy(a.policy)
    vocabulary_path = a.vocabulary or os.path.join(HERE, "..", "vocabulary", "popsign_signs.json")
    vocabulary = set(json.load(open(vocabulary_path))) if os.path.exists(vocabulary_path) else set()
    all_signs = sorted({m["sign"] for s in ("train", "val") for m in json.load(open(f"{a.cache}/{s}.json"))}
                       | vocabulary)
    classes, mapping = labels.build(all_signs, policy)
    C = len(classes); UNK = C
    json.dump({"classes": classes, "unknown_index": UNK, "policy_version": policy["version"],
               "validation_merges": policy.get("validation_merges", {})}, open(f"{a.out}/classes.json", "w"), indent=0)
    json.dump(vars(a), open(f"{a.out}/config.json", "w"), indent=1)

    tr_clips, tr_y, _ = load_split(a.cache, "train", mapping)
    va_clips, va_y, va_meta = load_split(a.cache, "val", mapping)
    if a.no_face:
        for c in tr_clips + va_clips: c[:, 55:] = np.nan
    def lab(y):
        return UNK if y == "unknown_train" else (y if isinstance(y, int) else None)
    train = [(c, lab(y)) for c, y in zip(tr_clips, tr_y) if lab(y) is not None and sign_span(c) is not None]
    if a.fs_negatives and os.path.exists(f"{a.cache}/fs_train.npz"):
        fz = np.load(f"{a.cache}/fs_train.npz"); fo = fz["offsets"]; fp = fz["pts"]  # read the array once
        fs = [fp[fo[i]:fo[i + 1]] for i in range(len(fo) - 1)]
        if a.no_face:
            for c in fs: c[:, 55:] = np.nan
        train += [(c, UNK) for c in fs if sign_span(c) is not None]
        print("added fingerspelling negatives as UNKNOWN:", len(fs), flush=True)
    va_known = [i for i, y in enumerate(va_y) if isinstance(y, int)]
    va_prep = prepared([va_clips[i] for i in va_known]); va_true = np.array([va_y[i] for i in va_known])
    print(f"classes {C} (+UNKNOWN) | train clips {len(train)} | val known clips {len(va_known)}", flush=True)

    device = resolve_device(a.device)
    model = SignModel(C + 1, d=a.dim, depth=a.depth, kind=a.kind).to(device)
    print("device", device, flush=True)
    print("params", sum(p.numel() for p in model.parameters()), flush=True)
    opt = torch.optim.AdamW(model.parameters(), lr=a.lr, weight_decay=a.wd)
    steps_per_epoch = math.ceil(len(train) / a.bs); total = steps_per_epoch * a.epochs; warm = steps_per_epoch * 2
    sched = torch.optim.lr_scheduler.LambdaLR(opt, lambda s: min(1, (s + 1) / warm) * 0.5 * (1 + math.cos(math.pi * min(1, s / total))))
    cw = torch.ones(C + 1, device=device); cw[UNK] = a.unknown_weight
    if a.balance > 0:
        cnt = np.bincount([y for _, y in train if y != UNK], minlength=C).astype(np.float64)
        med = np.median(cnt[cnt > 0])
        w = np.where(cnt > 0, (med / np.maximum(cnt, 1)) ** a.balance, 1.0)
        cw[:C] = torch.tensor(w, dtype=torch.float32, device=device)
        print("class-balanced weights: min %.2f max %.2f" % (w.min(), w.max()), flush=True)
    start, best = 0, -1
    if os.path.exists(f"{a.out}/ckpt.pt"):
        ck = torch.load(f"{a.out}/ckpt.pt", weights_only=False)
        model.load_state_dict(ck["model"]); opt.load_state_dict(ck["opt"]); sched.load_state_dict(ck["sched"])
        start, best = ck["epoch"] + 1, ck["best"]; rng = np.random.default_rng(a.seed + start)
        print("resumed at epoch", start, flush=True)
    for ep in range(start, a.epochs):
        model.train(); t0 = time.time(); order = rng.permutation(len(train)); tl = 0; n = 0
        if a.late_drop_epoch and ep == a.late_drop_epoch: model.head_drop.p = 0.6
        for i in range(0, len(order), a.bs):
            items, ys = [], []
            for j in order[i:i + a.bs]:
                c, y = train[j]
                p = prepare_clip(augment(c, rng))
                if p is None: continue
                items.append(p); ys.append(y)
            if len(items) < 2: continue
            x, v, m = batchify(items)
            x, v, m = x.to(device), v.to(device), m.to(device); yt = torch.tensor(ys, device=device)
            tl_ = int(m.sum(1).max().item()); x, v, m = x[:, :tl_], v[:, :tl_], m[:, :tl_]  # crop shared padding
            loss = F.cross_entropy(model(x, v, m), yt, weight=cw, label_smoothing=a.smooth)
            opt.zero_grad(); loss.backward(); torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0); opt.step(); sched.step()
            tl += loss.item() * len(ys); n += len(ys)
        ok, L, _ = predict(model, va_prep)
        pred = np.full(len(va_prep), -1); pred[ok] = L[:, :C].argmax(1)
        top5 = np.zeros(len(va_prep), bool); top5[ok] = (np.argsort(-L[:, :C], 1)[:, :5] == va_true[ok, None]).any(1)
        acc = float((pred == va_true).mean()); acc5 = float(top5.mean())
        rec = {"epoch": ep, "loss": tl / max(n, 1), "val_top1": acc, "val_top5": acc5, "val_n": len(va_true),
               "lr": sched.get_last_lr()[0], "sec": round(time.time() - t0, 1)}
        print(json.dumps(rec), flush=True)
        open(f"{a.out}/log.jsonl", "a").write(json.dumps(rec) + "\n")
        if acc > best:
            best = acc; torch.save({"model": {k: v.detach().cpu() for k, v in model.state_dict().items()}, "epoch": ep, "val_top1": acc, "args": vars(a), "C": C}, f"{a.out}/best.pt")
        torch.save({"model": {k: v.detach().cpu() for k, v in model.state_dict().items()},
                    "opt": opt.state_dict(), "sched": sched.state_dict(), "epoch": ep, "best": best}, f"{a.out}/ckpt.pt")
    print("done best", best, flush=True)


if __name__ == "__main__":
    main()
