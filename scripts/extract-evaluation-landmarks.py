"""Local diagnostic capture using the same MediaPipe tasks/settings as the app.

Requires mediapipe==0.10.21 and OpenCV. Pass a constant-frame-rate video;
convert GIFs with ffmpeg first to preserve animation timing. Camera frames
are not sent to a service. This does not measure recognition accuracy itself.
"""
import argparse
import json
from pathlib import Path

import cv2
import mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("video", type=Path)
parser.add_argument("output", type=Path)
parser.add_argument("--models", type=Path, required=True)
parser.add_argument("--fps", type=float, default=20)
args = parser.parse_args()
if args.fps <= 0:
    parser.error("--fps must be positive")

face_indices = [0, 4, 10, 13, 14, 17, 33, 61, 70, 105, 133, 145, 159, 263, 291, 300, 334, 362, 374, 386]

def point(value):
    result = {"x": value.x, "y": value.y, "z": value.z}
    if value.visibility is not None:
        result["visibility"] = value.visibility
    return result

def options(filename):
    return python.BaseOptions(model_asset_path=str(args.models / filename))

with vision.GestureRecognizer.create_from_options(vision.GestureRecognizerOptions(
    base_options=options("gesture_recognizer.task"), running_mode=vision.RunningMode.VIDEO,
    num_hands=2, min_hand_detection_confidence=0.55, min_hand_presence_confidence=0.55,
    min_tracking_confidence=0.55,
)) as hands, vision.FaceLandmarker.create_from_options(vision.FaceLandmarkerOptions(
    base_options=options("face_landmarker.task"), running_mode=vision.RunningMode.VIDEO,
    min_face_detection_confidence=0.55, min_face_presence_confidence=0.55, min_tracking_confidence=0.55,
)) as face, vision.PoseLandmarker.create_from_options(vision.PoseLandmarkerOptions(
    base_options=options("pose_landmarker_lite.task"), running_mode=vision.RunningMode.VIDEO,
    min_pose_detection_confidence=0.55, min_pose_presence_confidence=0.55, min_tracking_confidence=0.55,
)) as pose:
    video = cv2.VideoCapture(str(args.video))
    fps = video.get(cv2.CAP_PROP_FPS)
    if not video.isOpened() or fps <= 0:
        raise ValueError("Video could not be opened with valid timing")
    frames, last_face, last_pose = [], [], []
    last_sample, last_aux, index = -1e9, -1e9, 0
    try:
        while True:
            ok, pixels = video.read()
            if not ok:
                break
            timestamp = round(index * 1000 / fps)
            index += 1
            if timestamp - last_sample < 1000 / args.fps - 1:
                continue
            last_sample = timestamp
            image = mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(pixels, cv2.COLOR_BGR2RGB))
            result = hands.recognize_for_video(image, timestamp)
            if timestamp - last_aux >= 150:
                f = face.detect_for_video(image, timestamp)
                p = pose.detect_for_video(image, timestamp)
                last_face = [point(f.face_landmarks[0][i]) for i in face_indices] if f.face_landmarks else []
                last_pose = [point(value) for value in p.pose_landmarks[0]] if p.pose_landmarks else []
                last_aux = timestamp
            observations = []
            for i, landmarks in enumerate(result.hand_landmarks):
                gesture = result.gestures[i][0] if result.gestures[i] else None
                observations.append({"landmarks": [point(value) for value in landmarks],
                    "handedness": result.handedness[i][0].category_name,
                    "gesture": gesture.category_name if gesture else "None",
                    "gestureScore": gesture.score if gesture else 0})
            frames.append({"timestamp": timestamp, "hands": observations, "face": last_face, "pose": last_pose})
    finally:
        video.release()
args.output.write_text(json.dumps(frames), encoding="utf-8")
print(json.dumps({"frames": len(frames), "framesWithHands": sum(bool(f["hands"]) for f in frames)}))
