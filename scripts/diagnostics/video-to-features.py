#!/usr/bin/env python3
"""Turn any sign-language video into the 86-point rows the V3.1 worker sends, so the shipped model can
be scored on footage it has never seen.

Mirrors engine-v3/pipeline/extract.py (the same MediaPipe tasks, the same slots, the same aspect
correction as engine-v3/web/preprocess.mjs:gatherFrame) but reads a local file, so a check needs no
dataset, cache or GPU. Feed the output to scripts/diagnostics/replay-live-clip.mjs.

    pip install mediapipe opencv-python            # optional, diagnostics only
    python3 scripts/diagnostics/video-to-features.py clip.mp4 out.json [--seconds 30]
    node --experimental-strip-types scripts/diagnostics/replay-live-clip.mjs out.json --label PLEASE

Use only video you are allowed to download and keep. The frames are not stored - only landmarks.
"""
from __future__ import annotations

import argparse, json, os, sys

import cv2
import mediapipe as mp
from mediapipe.tasks import python as mpt
from mediapipe.tasks.python import vision

ROOT = os.path.join(os.path.dirname(__file__), "..", "..", "public", "vision", "models")
POSE = [0, 2, 5, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]   # pose landmarks V3.1 keeps
N_POINTS = 86
MODEL_SHA = "b3e05424f4674d8235ac8bc51970cef6822e12ac629c4a02bca596bc7f5d3090"


class Tracker:
    def __init__(self) -> None:
        self.hand = vision.HandLandmarker.create_from_options(vision.HandLandmarkerOptions(
            base_options=mpt.BaseOptions(model_asset_path=os.path.join(ROOT, "hand_landmarker.task")),
            running_mode=vision.RunningMode.VIDEO, num_hands=2))
        self.pose = vision.PoseLandmarker.create_from_options(vision.PoseLandmarkerOptions(
            base_options=mpt.BaseOptions(model_asset_path=os.path.join(ROOT, "pose_landmarker_lite.task")),
            running_mode=vision.RunningMode.VIDEO, num_poses=1))

    def frame(self, image: mp.Image, at_ms: int, width: int, height: int) -> list:
        hands = self.hand.detect_for_video(image, at_ms)
        body = self.pose.detect_for_video(image, at_ms)
        long_side = max(width, height)
        ax, ay = width / long_side, height / long_side
        row: list[float | None] = [None] * (N_POINTS * 3)

        def put(slot: int, point) -> None:
            row[slot * 3] = round(point.x * ax, 5)
            row[slot * 3 + 1] = round(point.y * ay, 5)
            row[slot * 3 + 2] = round(point.z, 5)

        best = [0.0, 0.0]
        for index, landmarks in enumerate(hands.hand_landmarks):
            category = hands.handedness[index][0]
            slot = 0 if category.category_name == "Left" else 1
            score = category.score or 0.0
            if best[slot] >= score:      # keep the most confident hand per slot, as extract.py does
                continue
            best[slot] = score
            for point_index in range(21):
                put(slot * 21 + point_index, landmarks[point_index])
        if body.pose_landmarks:
            for slot, pose_index in enumerate(POSE):
                point = body.pose_landmarks[0][pose_index]
                if (getattr(point, "visibility", 0) or 0) >= 0.5:
                    put(42 + slot, point)
        return row


def extract(path: str, seconds: float, tracker: Tracker) -> dict:
    capture = cv2.VideoCapture(path)
    fps = capture.get(cv2.CAP_PROP_FPS) or 30.0
    rows, index = [], 0
    while True:
        ok, frame = capture.read()
        if not ok:
            break
        index += 1
        if index / fps > seconds:
            break
        height, width = frame.shape[:2]
        # The training sources were reduced to a 480 px long side (preprocess.mjs:LONG_SIDE).
        if max(width, height) > 480:
            scale = 480 / max(width, height)
            frame = cv2.resize(frame, (int(width * scale), int(height * scale)))
            height, width = frame.shape[:2]
        image = mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
        rows.append(tracker.frame(image, int(index * 1000 / fps), width, height))
    capture.release()
    return {"tool": "signrelay-live-clip-v1", "source": path, "capturedAt": "external-video",
            "model": {"version": "v3.1", "sha256": MODEL_SHA, "policy": "strict"},
            "frames": len(rows), "fps": fps, "clip": rows}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("video")
    parser.add_argument("out")
    parser.add_argument("--seconds", type=float, default=30.0, help="analyse at most this much video")
    args = parser.parse_args()
    tracker = Tracker()
    result = extract(args.video, args.seconds, tracker)
    with open(args.out, "w") as handle:
        json.dump(result, handle)
    hands = sum(1 for row in result["clip"] if any(v is not None for v in row[0:42 * 3:3]))
    print(f"{os.path.basename(args.video)}: {result['frames']} frames at {result['fps']:.0f} fps, "
          f"hands in {hands} -> {args.out}")
    return 0 if hands else 1


if __name__ == "__main__":
    sys.exit(main())
