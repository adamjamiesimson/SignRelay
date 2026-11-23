#!/usr/bin/env python3
"""Native MediaPipe 0.10.35 observations for a replay reel (diagnostic reference).

Tracks every reel frame (or a simulated lower cadence) with the same hand/pose task
bundles and the V3.1 point layout, and writes the observation format consumed by
offline-v31-replay.mjs. This isolates browser scheduling and tracker cadence from the
downstream segmenter/classifier. It is not an application measurement.

usage: native-reel-observations.py reel.y4m out.json [--rate 15] [--pose-every 1]
"""
import argparse
import json
import subprocess
from pathlib import Path

import numpy as np
import mediapipe as mp
from mediapipe.tasks import python as mpt
from mediapipe.tasks.python import vision

ROOT = Path(__file__).resolve().parents[2]
MODELS = ROOT / "public/vision/models"
POSE = [0, 2, 5, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]
N_POINTS = 86


def frames(reel: Path):
    header = reel.open("rb").readline().decode()
    width = int(next(p[1:] for p in header.split() if p.startswith("W")))
    height = int(next(p[1:] for p in header.split() if p.startswith("H")))
    process = subprocess.Popen(["ffmpeg", "-v", "error", "-i", str(reel), "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
                               stdout=subprocess.PIPE)
    size = width * height * 3
    while chunk := process.stdout.read(size):
        if len(chunk) < size:
            break
        yield np.frombuffer(chunk, np.uint8).reshape(height, width, 3), width, height
    process.wait()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("reel", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--rate", type=float, default=15.0, help="simulated analysed frames per second (<= reel fps)")
    parser.add_argument("--pose-every", type=int, default=1)
    args = parser.parse_args()
    base = lambda name: mpt.BaseOptions(model_asset_path=str(MODELS / name))
    video = vision.RunningMode.VIDEO
    hand = vision.HandLandmarker.create_from_options(vision.HandLandmarkerOptions(
        base_options=base("hand_landmarker.task"), running_mode=video, num_hands=2))
    pose = vision.PoseLandmarker.create_from_options(vision.PoseLandmarkerOptions(
        base_options=base("pose_landmarker_lite.task"), running_mode=video))
    observations, last_kept, kept, last_pose = [], -1e9, 0, None
    for index, (rgb, width, height) in enumerate(frames(args.reel)):
        t = index * 1000.0 / 15
        if t - last_kept < 1000.0 / args.rate - 4:
            continue
        last_kept = t
        kept += 1
        image = mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb))
        ts = int(round(t))
        out = np.full((N_POINTS, 3), np.nan, np.float32)
        L = max(width, height)
        ax, ay = width / L, height / L
        best = [0.0, 0.0]
        result = hand.detect_for_video(image, ts)
        for landmarks, handedness in zip(result.hand_landmarks, result.handedness):
            slot = 0 if handedness[0].category_name == "Left" else 1
            if best[slot] >= handedness[0].score:
                continue
            best[slot] = handedness[0].score
            for j, p in enumerate(landmarks):
                out[slot * 21 + j] = (p.x * ax, p.y * ay, p.z)
        if last_pose is None or (kept - 1) % args.pose_every == 0:
            last_pose = pose.detect_for_video(image, ts)
        if last_pose.pose_landmarks:
            landmarks = last_pose.pose_landmarks[0]
            for j, k in enumerate(POSE):
                p = landmarks[k]
                if (p.visibility or 0) >= 0.5:
                    out[42 + j] = (p.x * ax, p.y * ay, p.z)
        observations.append({"t": t, "f": [None if not np.isfinite(v) else float(v) for v in out.reshape(-1)]})
    args.output.write_text(json.dumps({"cameraStart": 0, "source": "native mediapipe 0.10.35", "rate": args.rate,
                                       "poseEvery": args.pose_every, "observations": observations}))
    hands = sum(1 for o in observations if any(v is not None for v in o["f"][:126]))
    print(json.dumps({"frames": len(observations), "hand_frames": hands}))


if __name__ == "__main__":
    main()
