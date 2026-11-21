"""Compare the native reference pipeline with Chrome on identical video files.

  python native_vs_chrome.py <chrome.json> <model_dir> <out.json>

Stage 1 native: ffmpeg decode (15 Hz, long side 480) + MediaPipe Tasks (Python 0.10.35) +
       build_cache.gather + prepare_clip + ONNX Runtime (CPU) + decision policy.
Stage 3 Chrome: the lab's <video> seek decode + MediaPipe Tasks WASM + ONNX Runtime Web,
       read from chrome-file-run.mjs output (per-frame gathered landmarks and final result).
Reports per clip: frame counts, hand-frame counts, landmark agreement on frames where both saw a
hand, ONNX logits of each side, top-1 agreement and final decision agreement. Also runs the
Chrome landmarks through native ONNX (isolates decode/tracking drift from runtime drift).
"""
import json, os, sys, tempfile
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "pipeline")); sys.path.insert(0, os.path.join(HERE, "..", "train"))
from extract import probe, out_size, decode, Tracker  # noqa: E402
from build_cache import gather  # noqa: E402
from v3model import prepare_clip  # noqa: E402
from evaluate import decide, softmax_T  # noqa: E402


def native_frames(path, tracker):
    meta = probe(path); ow, oh = out_size(meta["width"], meta["height"])
    res = tracker.run(decode(path, ow, oh, fast=False))
    z = dict(width=ow, height=oh, **{k: v.astype(np.float32) for k, v in res.items()})
    return gather(z)


def run_onnx(sess, pts):
    p = prepare_clip(pts.astype(np.float32))
    if p is None: return None
    x, v, f = (t[None] for t in p)
    lg, emb = sess.run(None, {"x": x, "valid": v, "fmask": f})
    return lg[0], emb[0]


def main(chrome_json, model_dir, out):
    import onnxruntime as ort
    meta = json.load(open(f"{model_dir}/meta.json")); C = len(meta["classes"]); pol = meta["policy"]
    protos = None
    if meta.get("prototypes_b64"):
        import base64
        protos = np.frombuffer(base64.b64decode(meta["prototypes_b64"]), np.float32).reshape(C, -1)
    so = ort.SessionOptions(); so.intra_op_num_threads = 1
    sess = ort.InferenceSession(f"{model_dir}/model.onnx", so, providers=["CPUExecutionProvider"])
    tr = Tracker()
    no_face = meta.get("uses_face") is False
    ch = json.load(open(chrome_json)); rows = []
    failures = [os.path.basename(r["video"]) for r in ch["results"] if "error" in r]
    for r in ch["results"]:
        if "error" in r:
            rows.append({"video": os.path.basename(r["video"]), "browser_failure": r["error"], "top1_agree": False, "decision_agree": False}); continue
        nat = native_frames(r["video"], tr)
        if no_face: nat[:, 55:] = np.nan
        chp = np.array([[np.nan if v is None else v for v in f] for f in r["frames"]], np.float32).reshape(len(r["frames"]), 86, 3)
        n = min(len(nat), len(chp))
        hn = np.isfinite(nat[:, :42, 0]).any(1); hc = np.isfinite(chp[:, :42, 0]).any(1)
        both = np.isfinite(nat[:n, :42, 0]) & np.isfinite(chp[:n, :42, 0])
        d = np.abs(nat[:n, :42, :2] - chp[:n, :42, :2])[both]
        on = run_onnx(sess, nat); oc = run_onnx(sess, chp)
        dec = lambda o: None if o is None else decide(softmax_T(o[0][None], pol["temperature"]), o[1][None], pol, C, protos)
        dn, dc = dec(on), dec(oc)
        cl = r["result"]
        row = {"video": os.path.basename(r["video"]), "frames_native": int(len(nat)), "frames_chrome": int(len(chp)),
               "hand_frames_native": int(hn.sum()), "hand_frames_chrome": int(hc.sum()),
               "hand_point_abs_err_median": float(np.median(d)) if d.size else None,
               "hand_point_abs_err_p95": float(np.percentile(d, 95)) if d.size else None,
               "native_top1": meta["classes"][int(on[0][:C].argmax())] if on else None,
               "chrome_landmarks_native_onnx_top1": meta["classes"][int(oc[0][:C].argmax())] if oc else None,
               "chrome_top1": cl.get("best"), "chrome_status": cl.get("status"),
               "native_status": None if dn is None else str(dn[0][0]),
               "chrome_runtime_vs_native_onnx_max_logit_err": float(np.abs(np.array(cl["logits"]) - oc[0]).max()) if oc and cl.get("logits") else None}
        row["top1_agree"] = row["native_top1"] == row["chrome_top1"]
        row["decision_agree"] = (row["native_status"], row["native_top1"] if row["native_status"] == "accepted" else None) == \
                                (row["chrome_status"], cl.get("label"))
        rows.append(row); print(json.dumps(row))
    summ = {"clips": len(rows), "top1_agreement": float(np.mean([r["top1_agree"] for r in rows])),
            "decision_agreement": float(np.mean([r["decision_agree"] for r in rows])),
            "browser_failures": failures,
            "median_hand_point_err": float(np.nanmedian([r.get("hand_point_abs_err_median") or np.nan for r in rows])),
            "chrome_startup_ms": ch["startupMs"], "crossOriginIsolated": ch["crossOriginIsolated"], "userAgent": ch["userAgent"]}
    json.dump({"summary": summ, "clips": rows}, open(out, "w"), indent=1); print(json.dumps(summ, indent=1))


if __name__ == "__main__":
    main(*sys.argv[1:4])
