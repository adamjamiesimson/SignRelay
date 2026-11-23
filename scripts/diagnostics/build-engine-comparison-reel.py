#!/usr/bin/env python3
"""Make a loopback/browser fake-camera reel from local, licensed evaluation clips."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
from urllib.request import urlopen

WIDTH, HEIGHT, FPS = 640, 480, 15
GAP_FRAMES, PREROLL_FRAMES, TAIL_FRAMES = 30, 120, 45
FRAME_BYTES = WIDTH * HEIGHT * 3 // 2
VALIDATION_SOURCE = "https://signdata.cc.gatech.edu/data/popsign_v2_1/game/val/"
GRAY = b"FRAME\n" + b"\x7e" * (WIDTH * HEIGHT) + b"\x80" * (WIDTH * HEIGHT // 2)


def clip_frames(path: Path, output) -> int:
    resize = (f"fps={FPS},scale={WIDTH}:{HEIGHT}:force_original_aspect_ratio=decrease,"
              f"pad={WIDTH}:{HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=0x808080,setsar=1,format=yuv420p")
    command = ["ffmpeg", "-v", "error", "-threads", "1", "-filter_threads", "1", "-i", str(path),
               "-an", "-sn", "-vf", resize, "-f", "yuv4mpegpipe", "pipe:1"]
    count = 0
    with subprocess.Popen(command, stdout=subprocess.PIPE) as process:
        assert process.stdout is not None
        if not process.stdout.readline().startswith(b"YUV4MPEG2 "):
            raise ValueError(f"{path}: invalid reel header")
        while marker := process.stdout.readline():
            if not marker.startswith(b"FRAME"):
                raise ValueError(f"{path}: invalid frame marker")
            frame = process.stdout.read(FRAME_BYTES)
            if len(frame) != FRAME_BYTES:
                raise ValueError(f"{path}: truncated frame")
            output.write(b"FRAME\n")
            output.write(frame)
            count += 1
        if process.wait() or count == 0:
            raise ValueError(f"{path}: decoder did not complete")
    return count


def verified_clip(row, fetch_validation: bool) -> Path:
    path = Path(row["video"])
    source = row["source"]
    if path.exists():
        if hashlib.sha256(path.read_bytes()).hexdigest() != row["sha256"]:
            raise ValueError(f"{path}: clip fingerprint differs from the plan")
        return path
    if not fetch_validation or not source.startswith(VALIDATION_SOURCE):
        raise FileNotFoundError(path)
    if path.is_absolute() or ".." in path.parts or path.parts[:3] != ("evaluation", "videos", "engine-comparison"):
        raise ValueError(f"{path}: validation download must stay in the ignored comparison directory")
    max_size = 25 * 1024 * 1024
    with urlopen(source, timeout=60) as response:
        if not response.geturl().startswith(VALIDATION_SOURCE):
            raise ValueError("Validation download redirected outside the licensed cohort")
        content = response.read(max_size + 1)
    if len(content) > max_size or hashlib.sha256(content).hexdigest() != row["sha256"]:
        raise ValueError(f"{path}: downloaded clip does not match the pinned fingerprint")
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("xb") as output:
        output.write(content)
    return path


def make_reel(plan: Path, reel: Path, truth: Path, cohort: str | None, fetch_validation: bool, gap_frames: int = GAP_FRAMES) -> None:
    rows = json.loads(plan.read_text())
    if isinstance(rows, dict):
        if cohort is None:
            raise ValueError("Choose a --cohort key from the plan")
        rows = rows[cohort]
    if not rows:
        raise ValueError("No clips in the plan")
    paths = [verified_clip(row, fetch_validation) for row in rows]
    segments = []
    frame_index = PREROLL_FRAMES
    with reel.open("xb") as output:
        output.write(f"YUV4MPEG2 W{WIDTH} H{HEIGHT} F{FPS}:1 Ip A1:1 C420jpeg\n".encode())
        for _ in range(PREROLL_FRAMES):
            output.write(GRAY)
        for row, path in zip(rows, paths):
            start = frame_index
            frame_index += clip_frames(path, output)
            segments.append({"trial_id": row["trial_id"], "label": row["label"], "category": row["category"],
                             "start": start / FPS, "end": frame_index / FPS,
                             "source": row["source"], "sha256": row["sha256"], "license": row["license"]})
            for _ in range(gap_frames):
                output.write(GRAY)
            frame_index += gap_frames
        for _ in range(TAIL_FRAMES):
            output.write(GRAY)
        frame_index += TAIL_FRAMES
    with truth.open("x") as output:
        json.dump({"width": WIDTH, "height": HEIGHT, "fps": FPS, "duration": frame_index / FPS,
                   "segments": segments}, output, indent=2)
        output.write("\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for path in ("plan", "reel", "truth"):
        parser.add_argument(path, type=Path)
    parser.add_argument("--cohort", help="shared|broad for the showcase plan; A|B for the sprint development cohort")
    parser.add_argument("--fetch-validation", action="store_true", help="Download only the exact pinned publisher validation clips")
    parser.add_argument("--gap-frames", type=int, default=GAP_FRAMES,
                        help="grey frames between clips (0 = back-to-back signs separated only by each clip's own rest)")
    args = parser.parse_args()
    make_reel(args.plan, args.reel, args.truth, args.cohort, args.fetch_validation, args.gap_frames)
