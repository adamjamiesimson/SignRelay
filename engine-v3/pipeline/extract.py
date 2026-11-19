"""Engine V3 landmark extraction (native reference pipeline).

For each manifest row: download the official mp4 over HTTPS, hash it, probe it,
decode at a fixed analysis rate with the long side scaled to 480 px, and run the
MediaPipe Tasks Hand Landmarker (2 hands), Pose Landmarker Lite and Face
Landmarker in VIDEO mode -- the same task bundles and tasks-vision release
(0.10.35) the browser lab uses. Writes one compressed .npz per video and one
JSON status line per video (ok / excluded with reason). Video bytes are deleted
after processing; nothing here is redistributable source media.

Resumable: rows whose output already exists are skipped.
"""
from __future__ import annotations

import argparse, hashlib, json, os, subprocess, sys, tempfile, time, traceback
from concurrent.futures import ThreadPoolExecutor
from multiprocessing import Process, Queue

import numpy as np

MODELS = os.environ.get("SIGNRELAY_MODELS", "/home/user/data/models")
FPS = 15.0          # analysis rate (frames per source second)
LONG_SIDE = 480     # decoded long side in px; browser uses the same rule
EXTRACTOR_VERSION = "v3-extract-1"


def probe(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                          "stream=width,height,r_frame_rate,nb_frames,codec_name:stream_side_data=rotation:format=duration",
                          "-of", "json", path], capture_output=True, text=True, check=True).stdout
    j = json.loads(out)
    st = j["streams"][0]
    rot = 0
    for sd in st.get("side_data_list", []) or []:
        if "rotation" in sd: rot = int(sd["rotation"])
    w, h = int(st["width"]), int(st["height"])
    if abs(rot) in (90, 270): w, h = h, w
    num, den = st.get("r_frame_rate", "0/1").split("/")
    return {"width": w, "height": h, "rotation": rot, "codec": st.get("codec_name"),
            "fps": float(num) / float(den or 1), "nb_frames": int(st.get("nb_frames") or 0),
            "duration": float(j.get("format", {}).get("duration") or 0)}


def out_size(w, h):
    s = LONG_SIDE / max(w, h)
    ow, oh = int(round(w * s / 2) * 2), int(round(h * s / 2) * 2)
    return ow, oh


def decode(path, ow, oh, fast=False, start=None, dur=None, pre=None):
    # fast=True skips the H.264 deblocking filter (training clips only; ~25% faster on
    # 120 fps 6 MP sources). Validation/test use full-quality decoding like a browser.
    win = (["-ss", f"{start:.3f}"] if start is not None else []) + (["-t", f"{dur:.3f}"] if dur is not None else [])
    cmd = ["ffmpeg", "-v", "error", "-threads", "1"] + (["-skip_loop_filter", "all"] if fast else []) + win + ["-i", path, "-vf",
           (f"{pre}," if pre else "") + f"fps={FPS},scale={ow}:{oh}:flags=area", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]
    raw = subprocess.run(cmd, capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.uint8).reshape(-1, oh, ow, 3)


class Tracker:
    def __init__(self):
        import mediapipe as mp
        from mediapipe.tasks import python as mpt
        from mediapipe.tasks.python import vision
        self.mp, self.vision, self.mpt = mp, vision, mpt

    def run(self, frames, fps=FPS):
        mp, vision, mpt = self.mp, self.vision, self.mpt
        base = lambda f: mpt.BaseOptions(model_asset_path=f"{MODELS}/{f}")
        V = vision.RunningMode.VIDEO
        # fresh graphs per clip so tracking state never leaks between recordings
        hand = vision.HandLandmarker.create_from_options(vision.HandLandmarkerOptions(
            base_options=base("hand_landmarker.task"), running_mode=V, num_hands=2))
        pose = vision.PoseLandmarker.create_from_options(vision.PoseLandmarkerOptions(
            base_options=base("pose_landmarker_lite.task"), running_mode=V))
        face = vision.FaceLandmarker.create_from_options(vision.FaceLandmarkerOptions(
            base_options=base("face_landmarker.task"), running_mode=V))
        T = len(frames)
        H = np.full((T, 2, 21, 3), np.nan, np.float32)    # slot 0 = MediaPipe "Left", 1 = "Right"
        Hs = np.zeros((T, 2), np.float32)                  # handedness score
        P = np.full((T, 33, 4), np.nan, np.float32)        # x, y, z, visibility
        F = np.full((T, 478, 3), np.nan, np.float32)
        ts = np.zeros(T, np.int64)
        for i, f in enumerate(frames):
            t = int(round(i * 1000.0 / fps)); ts[i] = t
            im = mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(f))
            r = hand.detect_for_video(im, t)
            for lm, hd in zip(r.hand_landmarks, r.handedness):
                slot = 0 if hd[0].category_name == "Left" else 1
                if Hs[i, slot] >= hd[0].score: continue  # keep best per slot
                H[i, slot] = [[p.x, p.y, p.z] for p in lm]; Hs[i, slot] = hd[0].score
            r = pose.detect_for_video(im, t)
            if r.pose_landmarks:
                P[i] = [[p.x, p.y, p.z, p.visibility] for p in r.pose_landmarks[0]]
            r = face.detect_for_video(im, t)
            if r.face_landmarks:
                F[i] = [[p.x, p.y, p.z] for p in r.face_landmarks[0]]
        hand.close(); pose.close(); face.close()
        return dict(hands=H.astype(np.float16), hand_score=Hs.astype(np.float16), pose=P.astype(np.float16),
                    face=F.astype(np.float16), ts_ms=ts)


def download(url, dest):
    for attempt in range(6):
        r = subprocess.run(["curl", "-sS", "--fail", "-m", "300", "-A", "SignRelay-research", "-o", dest, url],
                           capture_output=True, text=True)
        if r.returncode == 0: return
        if "404" in r.stderr: raise FileNotFoundError(url)
        time.sleep(2 ** attempt)
    raise RuntimeError(f"download failed {url}: {r.stderr[-200:]}")


_ZIPS = {}
ASLC_URL = "https://download.microsoft.com/download/b/8/8/b88c0bae-e6c1-43e1-8726-98cf5af36ca4/ASL_Citizen.zip"


def fetch_zip_member(member, dest, url=ASLC_URL):
    """Read one member of a large remote zip via HTTPS byte ranges (evaluation-only cohort)."""
    import zipfile
    from remote_zip import RemoteFile
    if url not in _ZIPS: _ZIPS[url] = zipfile.ZipFile(RemoteFile(url))
    with _ZIPS[url].open(member) as src, open(dest, "wb") as out:
        out.write(src.read())


def key(row):
    return f"{row['split']}/{row['sign']}/{row['file'][:-4]}" + (f"@{row['condition']}" if row.get("condition") else "")


def worker(wid, rows, outdir, status_path, q):
    tr = Tracker()
    tmp = tempfile.mkdtemp(prefix=f"v3w{wid}-", dir="/dev/shm" if os.path.isdir("/dev/shm") else None)
    pool = ThreadPoolExecutor(2)

    def fetch(row):
        dest = os.path.join(tmp, row["file"].replace(" ", "_"))
        try:
            if row.get("zip_member"): fetch_zip_member(row["zip_member"], dest)
            else: download(row["url"], dest)
            return dest, None
        except Exception as e:  # noqa
            return None, repr(e)

    futs = [pool.submit(fetch, r) for r in rows[:2]]
    nxt = 2
    with open(status_path, "a") as log:
        for i, row in enumerate(rows):
            path, err = futs[i].result()
            if nxt < len(rows): futs.append(pool.submit(fetch, rows[nxt])); nxt += 1
            rec = {"key": key(row), "split": row["split"], "sign": row["sign"], "signer": row["signer"],
                   "file": row["file"], "extractor": EXTRACTOR_VERSION}
            for extra in ("aslc_gloss", "role", "window_start", "window_dur", "phrase", "condition", "vf_pre"):
                if extra in row: rec[extra] = row[extra]
            t0 = time.time()
            try:
                if err: raise RuntimeError("download: " + err)
                data = open(path, "rb").read()
                rec["sha256"] = hashlib.sha256(data).hexdigest(); rec["bytes"] = len(data)
                meta = probe(path); rec.update(meta)
                if row.get("geometry") == "webcam":  # perturbation output is landscape 4:3 of the source height
                    meta["width"], meta["height"] = meta["height"], int(round(meta["height"] * 0.75))
                ow, oh = out_size(meta["width"], meta["height"]); rec["analysis_size"] = [ow, oh]
                fast = row["split"] in ("train", "fs_train"); rec["fast_decode"] = fast
                frames = decode(path, ow, oh, fast, row.get("window_start"), row.get("window_dur"), row.get("vf_pre"))
                if len(frames) == 0: raise ValueError("no decodable frames")
                res = tr.run(frames)
                hp = np.isfinite(res["hands"][:, :, 0, 0].astype(np.float32)).any(1)
                rec.update(frames=int(len(frames)), hand_frames=int(hp.sum()),
                           pose_frames=int(np.isfinite(res["pose"][:, 0, 0].astype(np.float32)).sum()),
                           face_frames=int(np.isfinite(res["face"][:, 0, 0].astype(np.float32)).sum()))
                op = os.path.join(outdir, key(row) + ".npz")
                os.makedirs(os.path.dirname(op), exist_ok=True)
                np.savez_compressed(op + ".tmp.npz", width=ow, height=oh, fps=FPS, **res)
                os.replace(op + ".tmp.npz", op)
                rec["status"] = "ok"
            except Exception as e:  # recorded, never silently dropped
                rec["status"] = "error"; rec["reason"] = repr(e)[:300]
            finally:
                if path and os.path.exists(path): os.remove(path)
            rec["seconds"] = round(time.time() - t0, 2)
            log.write(json.dumps(rec) + "\n"); log.flush()
            q.put(1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("plan", help="JSON list of manifest rows to process")
    ap.add_argument("outdir")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--limit", type=int, default=0)
    a = ap.parse_args()
    rows = json.load(open(a.plan))
    done = set()
    os.makedirs(a.outdir, exist_ok=True)
    for f in os.listdir(a.outdir):
        if f.startswith("status-") and f.endswith(".jsonl"):
            for line in open(os.path.join(a.outdir, f)):
                try: done.add(json.loads(line)["key"])
                except Exception: pass
    todo = [r for r in rows if key(r) not in done]
    if a.limit: todo = todo[:a.limit]
    print(f"{len(rows)} planned, {len(done)} already recorded, {len(todo)} to do", flush=True)
    q = Queue()
    shards = [todo[i::a.workers] for i in range(a.workers)]
    ps = [Process(target=worker, args=(i, s, a.outdir, os.path.join(a.outdir, f"status-{os.getpid()}-{i}.jsonl"), q))
          for i, s in enumerate(shards)]
    for p in ps: p.start()
    n, t0 = 0, time.time()
    import queue
    while n < len(todo):
        try:
            q.get(timeout=120); n += 1
        except queue.Empty:
            dead = [p for p in ps if not p.is_alive()]
            if len(dead) == len(ps):
                print(f"all workers exited with {len(todo) - n} clips unrecorded; re-run this plan to finish", flush=True); break
            if dead and all(p.exitcode not in (0, None) for p in dead):
                print(f"worker died (exit {[p.exitcode for p in dead]}); continuing, re-run the plan afterwards", flush=True)
            continue
        if n % 200 == 0 or n == len(todo):
            el = time.time() - t0
            print(f"progress {n}/{len(todo)} {n/el*3600:.0f}/h eta {(len(todo)-n)/(n/el)/3600:.2f}h", flush=True)
    for p in ps: p.join()


if __name__ == "__main__":
    main()
