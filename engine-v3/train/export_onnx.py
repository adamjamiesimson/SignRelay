"""Export a trained V3 checkpoint to ONNX + meta.json and verify against PyTorch.

  python export_onnx.py --run runs/<name> --out ../models/<version> [--policy policy.json] [--prototypes]
Verification: PyTorch vs ONNX Runtime logits on real validation clips (max abs error, top-1 agreement).
"""
import argparse, base64, hashlib, json, os, sys
import numpy as np
import torch

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE); sys.path.insert(0, os.path.join(HERE, "..", "pipeline"))
from v3model import SignModel, ExportWrapper, prepare_clip, TMAX  # noqa: E402
from points import N_POINTS, contract  # noqa: E402


def load(run, which="best.pt"):
    cfg = json.load(open(f"{run}/config.json")); cls = json.load(open(f"{run}/classes.json"))
    m = SignModel(len(cls["classes"]) + 1, d=cfg["dim"], depth=cfg["depth"], kind=cfg["kind"])
    m.load_state_dict(torch.load(f"{run}/{which}", weights_only=False)["model"]); m.eval()
    return m, cfg, cls


class EnsembleWrapper(torch.nn.Module):
    """Mean log-probabilities of several models; concatenated, re-normalised embeddings.
    Mirrors evaluate.infer, so Python reports and the browser score the same ensemble."""
    def __init__(self, ms):
        super().__init__(); self.ms = torch.nn.ModuleList(ms)

    def forward(self, x, valid, fmask):
        ls, es = [], []
        for m in self.ms:
            e = m.embed(x, valid, fmask); ls.append(torch.log_softmax(m.head(e), -1)); es.append(torch.nn.functional.normalize(e, dim=-1))
        return torch.stack(ls).mean(0), torch.nn.functional.normalize(torch.cat(es, -1), dim=-1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", required=True, nargs="+"); ap.add_argument("--out", required=True)
    ap.add_argument("--which", default="best.pt"); ap.add_argument("--policy", default=None)
    ap.add_argument("--prototypes", default=None, help=".npy [C, D] class prototypes")
    ap.add_argument("--version", default="v3"); ap.add_argument("--cache", default="/home/user/data/cache")
    ap.add_argument("--threads", type=int, default=1)
    a = ap.parse_args()
    torch.set_num_threads(a.threads)
    loaded = [load(r, a.which) for r in a.run]; m, cfg, cls = loaded[0]
    os.makedirs(a.out, exist_ok=True)
    w = (ExportWrapper(m) if len(loaded) == 1 else EnsembleWrapper([l[0] for l in loaded])).eval()
    x = torch.zeros(1, TMAX, N_POINTS, 3); v = torch.zeros(1, TMAX, N_POINTS); f = torch.zeros(1, TMAX)
    path = f"{a.out}/model.onnx"
    torch.onnx.export(w, (x, v, f), path, input_names=["x", "valid", "fmask"], output_names=["logits", "embedding"],
                      dynamic_axes={"x": {0: "b"}, "valid": {0: "b"}, "fmask": {0: "b"}, "logits": {0: "b"}, "embedding": {0: "b"}},
                      opset_version=17, dynamo=False)
    import onnxruntime as ort
    so = ort.SessionOptions(); so.intra_op_num_threads = 1; so.inter_op_num_threads = 1
    sess = ort.InferenceSession(path, so, providers=["CPUExecutionProvider"])
    # verify on real clips
    z = np.load(f"{a.cache}/val.npz"); meta = json.load(open(f"{a.cache}/val.json"))
    offs = z["offsets"]; pts = z["pts"]; errs, agree, n = [], 0, 0
    for i in range(0, min(len(meta), 400)):
        c = pts[offs[i]:offs[i + 1]].astype(np.float32)
        if cfg.get("no_face"): c[:, 55:] = np.nan
        p = prepare_clip(c)
        if p is None: continue
        xi, vi, fi = (t[None] for t in p)
        with torch.no_grad(): tl, te = w(torch.from_numpy(xi), torch.from_numpy(vi), torch.from_numpy(fi))
        ol, oe = sess.run(None, {"x": xi, "valid": vi, "fmask": fi})
        errs.append(float(np.abs(ol - tl.numpy()).max())); agree += int(ol.argmax() == tl.numpy().argmax()); n += 1
    ver = {"clips": n, "max_abs_logit_error": max(errs) if errs else None, "top1_agreement": agree / max(n, 1)}
    print("onnx verification", ver)
    data = open(path, "rb").read()
    out = {"version": a.version, "model_sha256": hashlib.sha256(data).hexdigest(), "classes": cls["classes"],
           "unknown_index": cls["unknown_index"], "input": {"tmax": TMAX, "points": N_POINTS, "fps": 15, "long_side": 480},
           "contract": contract(), "train_config": cfg, "ensemble_runs": [os.path.basename(r.rstrip("/")) for r in a.run],
           "uses_face": not cfg.get("no_face"), "onnx_verification": ver,
           "policy": json.load(open(a.policy)) if a.policy else {"temperature": 1.0, "max_unknown": 0.5, "min_top1": 0.0, "min_margin": None, "min_proto": None, "min_hand_frames": 3},
           "data": "PopSign ASL v2.1 (Starner et al.), CC BY 4.0; https://signdata.cc.gatech.edu/"}
    if a.prototypes:
        P = np.load(a.prototypes).astype(np.float32); out["prototypes_b64"] = base64.b64encode(P.tobytes()).decode()
        out["prototypes_shape"] = list(P.shape)
    json.dump(out, open(f"{a.out}/meta.json", "w"))
    print("wrote", a.out, out["model_sha256"][:12], len(data), "bytes")


if __name__ == "__main__":
    main()
