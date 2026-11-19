"""Build a camera-replay reel (Y4M, 640x480, 30 fps) from local clips for Chrome's fake camera.

  python make_reel.py <plan.json> <out.y4m> <truth.json>
plan.json: [{"video": path, "label": GLOSS or "__unknown__"/"__motion__", "start": s, "dur": s}, ...]
Each clip is letterboxed into 640x480 (portrait phone clips become pillarboxed like a webcam view)
and separated by 1.5 s of a neutral frame without hands, so ground-truth intervals are known.
"""
import json, subprocess, sys

W, H, FPS, GAP = 640, 480, 30, 1.5

def main(plan_path, out, truth_path):
    plan = json.load(open(plan_path)); parts, truth, t = [], [], 0.0
    gap = f"color=c=0x808080:s={W}x{H}:r={FPS}:d={GAP}"
    filt, inputs = [], []
    for i, p in enumerate(plan):
        inputs += (["-ss", str(p["start"])] if p.get("start") is not None else []) + (["-t", str(p["dur"])] if p.get("dur") else []) + ["-i", p["video"]]
    n = len(plan)
    for i in range(n):
        filt.append(f"[{i}:v]fps={FPS},scale={W}:{H}:force_original_aspect_ratio=decrease,pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:color=0x808080,setsar=1,format=yuv420p[v{i}]")
        filt.append(f"{gap}[g{i}]")
    filt.append(f"{gap}[g{n}]")
    chain = "".join(f"[g{i}][v{i}]" for i in range(n)) + f"[g{n}]"
    filt.append(f"{chain}concat=n={2 * n + 1}:v=1:a=0,format=yuv420p[out]")
    subprocess.run(["ffmpeg", "-v", "error", "-y", *inputs, "-filter_complex", ";".join(filt), "-map", "[out]", "-f", "yuv4mpegpipe", out], check=True)
    for p in plan:
        d = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", p["video"]], capture_output=True, text=True).stdout)
        d = min(d - (p.get("start") or 0), p.get("dur") or 1e9)
        t += GAP; truth.append({"label": p["label"], "start": round(t, 3), "end": round(t + d, 3), "video": p["video"]}); t += d
    json.dump({"duration": t + GAP, "fps": FPS, "segments": truth}, open(truth_path, "w"), indent=1)
    print(out, "duration", round(t + GAP, 1), "s,", n, "clips")

if __name__ == "__main__":
    main(*sys.argv[1:4])
