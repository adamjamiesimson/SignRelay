"""Extract deterministic RGB samples at the timestamp of each authorized trace frame."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path

import cv2
import numpy as np

HAND_HASH = "fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1"
POSE_HASH = "59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a"


def digest(path):
    with Path(path).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


class NativeTracker:
    def __init__(self, hand_path, pose_path):
        import mediapipe as mp
        from mediapipe.tasks.python import BaseOptions, vision

        self.mp = mp
        mode = vision.RunningMode.VIDEO
        self.hand = vision.HandLandmarker.create_from_options(vision.HandLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=str(hand_path)), running_mode=mode,
            num_hands=2, min_hand_detection_confidence=0.55, min_hand_presence_confidence=0.55,
            min_tracking_confidence=0.55))
        try:
            self.pose = vision.PoseLandmarker.create_from_options(vision.PoseLandmarkerOptions(
                base_options=BaseOptions(model_asset_path=str(pose_path)), running_mode=mode, num_poses=1))
        except Exception:
            self.hand.close()
            raise
        self.last_pose = float("-inf")
        self.points = []

    @staticmethod
    def point(p):
        return {"x": p.x, "y": p.y, "z": p.z, "visibility": p.visibility}

    def run(self, frame, timestamp):
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        source = self.mp.Image(image_format=self.mp.ImageFormat.SRGB, data=rgb)
        hand = self.hand.detect_for_video(source, timestamp)
        hands = [{"landmarks": [self.point(p) for p in points], "handedness": categories[0].category_name}
                 for points, categories in zip(hand.hand_landmarks, hand.handedness)]
        if timestamp - self.last_pose >= 220:
            pose = self.pose.detect_for_video(source, timestamp)
            self.points = [self.point(p) for p in pose.pose_landmarks[0]] if pose.pose_landmarks else []
            self.last_pose = timestamp
        return {"timestamp": timestamp, "hands": hands, "pose": self.points}

    def close(self):
        self.hand.close()
        self.pose.close()


def pixels(image, hands):
    height, width = image.shape[:2]
    points = [p for hand in hands for p in hand["landmarks"]
              if 0 <= p["x"] <= 1 and 0 <= p["y"] <= 1]
    if not points:
        return None
    left, right = min(p["x"] for p in points), max(p["x"] for p in points)
    top, bottom = min(p["y"] for p in points), max(p["y"] for p in points)
    size = min(min(width, height), max((right - left) * width, (bottom - top) * height, height * 0.08) * 1.45)
    x = np.clip(((left + right) * width / 2 + ((np.arange(12) + 0.5) / 12 - 0.5) * size)
                .astype(int), 0, width - 1)
    y = np.clip(((top + bottom) * height / 2 + ((np.arange(12) + 0.5) / 12 - 0.5) * size)
                .astype(int), 0, height - 1)
    return (image[y[:, None], x[None, :], ::-1].reshape(-1) / 255).tolist()


def read_clip(item, output, assets=None):
    source = Path(item["file"])
    if digest(source) != item["sha256"]:
        raise ValueError("Recording bytes differ from frozen manifest")
    trace = json.loads(Path(item["trace"]).read_text(encoding="utf-8"))
    frames = trace["frames"]
    cap = cv2.VideoCapture(str(source), cv2.CAP_FFMPEG, [cv2.CAP_PROP_N_THREADS, 1])
    tracker = None
    try:
        if not cap.isOpened():
            raise ValueError("Unable to decode authorized media")
        width, height = (int(cap.get(key)) for key in (cv2.CAP_PROP_FRAME_WIDTH, cv2.CAP_PROP_FRAME_HEIGHT))
        result = {"sha256": item["sha256"], "width": width, "height": height, "frames": []}
        if assets:
            tracker = NativeTracker(*assets)
            result["tracker"] = {"protocol": "v2-tasks-video-v1", "hand": HAND_HASH, "pose": POSE_HASH,
                                 "mediapipe": tracker.mp.__version__, "maxDimension": 640, "poseIntervalMs": 220}
        scale = min(1, 640 / max(width, height))
        index = 0
        while index < len(frames) and cap.grab():
            timestamp = cap.get(cv2.CAP_PROP_POS_MSEC)
            if timestamp + 1 < frames[index]["timestamp"]:
                continue
            frame = frames[index]
            if timestamp - frame["timestamp"] > 2:
                raise ValueError(f"Decoded frame misses trace timestamp by {timestamp - frame['timestamp']:.2f} ms")
            rgb = None
            if tracker or frame["hands"]:
                ok, image = cap.retrieve()
                if not ok or image.shape[:2] != (height, width):
                    raise ValueError("Decoded frame dimensions changed")
                if tracker:
                    image = cv2.resize(image, (int(width * scale + 0.5), int(height * scale + 0.5)))
                    frame = tracker.run(image, frame["timestamp"])
                rgb = pixels(image, frame["hands"])
            result["frames"].append({"t": frame["timestamp"], "rgb": rgb,
                                     **({"frame": frame} if tracker else {})})
            index += 1
        if index != len(frames):
            raise ValueError(f"Missing decoded frames for {item['sha256'][:12]}")
        target = output / (item["sha256"] + ".json")
        temporary = target.with_suffix(".tmp")
        temporary.write_text(json.dumps(result, separators=(",", ":")), encoding="utf-8")
        temporary.replace(target)
    finally:
        if tracker:
            tracker.close()
        cap.release()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("intake", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--track", nargs=2, metavar=("HAND_TASK", "POSE_TASK"))
    args = parser.parse_args()
    if args.track and [digest(path) for path in args.track] != [HAND_HASH, POSE_HASH]:
        parser.error("V2 tracker inputs fail integrity verification")
    args.output.mkdir(exist_ok=True, parents=True)
    with ThreadPoolExecutor(max_workers=2) as pool:
        for index, _ in enumerate(pool.map(lambda item: read_clip(item, args.output, args.track),
                                           json.loads(args.intake.read_text(encoding="utf-8"))), 1):
            if index % 20 == 0:
                print(f"Decoded {index} authorized clips", flush=True)
