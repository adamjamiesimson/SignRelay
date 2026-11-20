"""Causal stage-by-stage diagnostic of the live camera path (development footage only).

  python camera_diagnostic.py <model_dir> <out.json> <replay.json> [<replay.json> ...]

For every ground-truth interval of a reel, the same frozen ONNX model and decision policy are applied
to progressively more realistic inputs, so the first stage at which a correct answer is lost can be
identified:

  S1 iso        native pipeline on the isolated source clip (offline reference, 15 Hz, long side 480)
  S2 reel15     native landmarks of the reel video (webcam geometry, re-encoding) at 15 Hz, oracle interval
  S3 reelcam    native landmarks of the reel at the Chrome camera's actual frame times, oracle interval
  S4 chrome     Chrome camera landmarks (logged per frame), oracle interval
  S5 live       the event(s) the live segmenter actually produced for the interval
For each stage: top-1 correct, accepted, accepted-correct, hand frames used.
The reel/camera clock offset is estimated by aligning Chrome hand presence with native hand presence.
"""
import base64, json, os, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "pipeline")); sys.path.insert(0, os.path.join(HERE, "..", "train"))
from extract import probe, out_size, decode, Tracker  # noqa: E402
from build_cache import gather  # noqa: E402
from v3model import prepare_clip, resample_to_15hz  # noqa: E402
from evaluate import decide, softmax_T  # noqa: E402

MARGIN = 0.6  # s, same window the live segmenter classifies around a segment


def track(frames, ts_ms, w, h, tr):
    res = tr.run(frames, fps=15)  # timestamps are re-derived below; VIDEO mode needs monotonic ts only
    z = dict(width=w, height=h, **{k: v.astype(np.float32) for k, v in res.items()})
    p = gather(z); p[:, 55:] = np.nan
    return p


def native_at(video, times_s, tr, long_side=480):
    """Decode the reel and track exactly the frames shown at the given times (camera cadence)."""
    m = probe(video); ow, oh = out_size(m["width"], m["height"]) if long_side == 480 else (m["width"], m["height"])
    import subprocess
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", video, "-vf", f"scale={ow}:{oh}:flags=area", "-f", "rawvideo",
                          "-pix_fmt", "rgb24", "-"], capture_output=True, check=True).stdout
    allf = np.frombuffer(raw, np.uint8).reshape(-1, oh, ow, 3); fps = 30.0
    idx = np.clip(np.round(np.asarray(times_s) * fps).astype(int), 0, len(allf) - 1)
    return track(allf[idx], None, ow, oh, tr)


class Scorer:
    def __init__(self, model_dir):
        import onnxruntime as ort
        self.meta = json.load(open(f"{model_dir}/meta.json")); self.C = len(self.meta["classes"])
        self.pol = self.meta["policy"]
        self.P = np.frombuffer(base64.b64decode(self.meta["prototypes_b64"]), np.float32).reshape(self.C, -1)
        so = ort.SessionOptions(); so.intra_op_num_threads = 1
        self.sess = ort.InferenceSession(f"{model_dir}/model.onnx", so, providers=["CPUExecutionProvider"])

    def __call__(self, frames, label):
        hands = int(np.isfinite(frames[:, :42, 0]).any(1).sum()) if len(frames) else 0
        p = prepare_clip(frames.astype(np.float32)) if len(frames) else None
        if p is None or hands < 3:
            return {"top1": None, "ok1": False, "status": "no-sign", "acc_ok": False, "hands": hands}
        lg, em = self.sess.run(None, {"x": p[0][None], "valid": p[1][None], "fmask": p[2][None]})
        st, i1 = decide(softmax_T(lg, self.pol["temperature"]), em, self.pol, self.C, self.P)
        top1 = self.meta["classes"][int(i1[0])]
        return {"top1": top1, "ok1": top1 == label, "status": str(st[0]), "acc_ok": str(st[0]) == "accepted" and top1 == label,
                "p_top1": float(softmax_T(lg, self.pol["temperature"])[0, :self.C].max()), "hands": hands}


def main(model_dir, out, *replays):
    sc = Scorer(model_dir); tr = Tracker(); rows = []
    for rp in replays:
        R = json.load(open(rp)); truth = R["truth"]; segs = truth["segments"]
        samples = R["samples"]; t0 = R["camera_t0"]
        ct = np.array([s["t"] for s in samples]) - t0  # ms since playback start
        cf = np.array([[np.nan if v is None else v for v in s["f"]] for s in samples], np.float32).reshape(len(samples), 86, 3)
        reel_mp4 = R["reel"].replace(".y4m", ".mp4")
        if not os.path.exists(reel_mp4):
            import subprocess
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", R["reel"], "-c:v", "libx264", "-crf", "12", "-pix_fmt", "yuv420p", reel_mp4], check=True)
        # native 15 Hz landmarks of the whole reel
        dur = truth["duration"]; n15 = int(dur * 15)
        nat15 = native_at(reel_mp4, np.arange(n15) / 15.0, tr)
        nh = np.isfinite(nat15[:, :42, 0]).any(1)
        # clock offset: shift chrome times to best match native hand presence
        chh = np.isfinite(cf[:, :42, 0]).any(1)
        best = (-1, 0.0)
        for off in np.arange(-600, 601, 33):
            k = np.clip(np.round((ct + off) / 1000 * 15).astype(int), 0, n15 - 1)
            agree = float((nh[k] == chh).mean())
            if agree > best[0]: best = (agree, off)
        off = best[1]; cts = (ct + off) / 1000.0
        natcam = native_at(reel_mp4, np.clip(cts, 0, dur - 1e-3), tr)
        for iv, s in enumerate(segs):
            a, b = s["start"] - MARGIN, s["end"] + MARGIN
            label = s["label"]
            row = {"reel": os.path.basename(rp), "interval": iv, "label": label, "clock_offset_ms": off, "hand_agree": best[0]}
            if not label.startswith("__"):
                from native_vs_chrome import native_frames
                iso = native_frames(s["video"], tr); iso[:, 55:] = np.nan
                row["S1_iso"] = sc(iso, label)
            k15 = (np.arange(n15) / 15.0 >= a) & (np.arange(n15) / 15.0 <= b)
            row["S2_reel15"] = sc(nat15[k15], label)
            kc = (cts >= a) & (cts <= b)
            row["camera_frames_in_interval"] = int(kc.sum()); row["camera_fps_in_interval"] = float(kc.sum() / (b - a))
            row["S3_reelcam"] = sc(resample_to_15hz(cts[kc] * 1000, natcam[kc]) if kc.sum() > 1 else natcam[kc], label)
            row["S4_chrome"] = sc(resample_to_15hz(cts[kc] * 1000, cf[kc]) if kc.sum() > 1 else cf[kc], label)
            evs = [e for e in R["events"] if e.get("segment") and
                   min((e["segment"][1] - t0 + off) / 1000, s["end"] + 0.4) - max((e["segment"][0] - t0 + off) / 1000, s["start"] - 0.4) > 0]
            acc = [e for e in evs if e["status"] == "accepted"]
            row["S5_live"] = {"events": len(evs), "statuses": [e["status"] for e in evs], "best": [e["best"] for e in evs],
                              "ok1": any(e["best"] == label for e in evs), "acc_ok": bool(acc) and acc[0]["label"] == label,
                              "segments_s": [[round((e["segment"][0] - t0 + off) / 1000, 2), round((e["segment"][1] - t0 + off) / 1000, 2)] for e in evs],
                              "truth_s": [s["start"], s["end"]], "handFrames": [e.get("handFrames") for e in evs]}
            rows.append(row)
    sup = [r for r in rows if not r["label"].startswith("__")]
    stages = ["S1_iso", "S2_reel15", "S3_reelcam", "S4_chrome", "S5_live"]
    summ = {s: {"top1": sum(r[s]["ok1"] for r in sup), "accepted_correct": sum(r[s]["acc_ok"] for r in sup), "n": len(sup)} for s in stages}
    # first stage that loses an accepted-correct (or top-1) result
    loss = {"top1": {}, "accepted": {}}
    for r in sup:
        for kind, key in (("top1", "ok1"), ("accepted", "acc_ok")):
            prev = None
            for s in stages:
                if prev is not None and r[prev][key] and not r[s][key]:
                    loss[kind][s] = loss[kind].get(s, 0) + 1; break
                prev = s
    unk = [r for r in rows if r["label"].startswith("__")]
    summ["unknown_intervals"] = len(unk)
    summ["unknown_false_accepts_live"] = sum(any(st == "accepted" for st in r["S5_live"]["statuses"]) for r in unk)
    summ["first_loss_stage"] = loss
    summ["camera_fps_median"] = float(np.median([r["camera_fps_in_interval"] for r in rows]))
    print(json.dumps(summ, indent=1, default=float), flush=True)
    json.dump({"summary": summ, "rows": rows}, open(out, "w"), indent=1, default=lambda o: o.item() if hasattr(o, "item") else str(o))


if __name__ == "__main__":
    main(*sys.argv[1:])
