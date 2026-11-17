"""Extract local ASL development landmarks with MediaPipe's native Tasks runtime."""

import argparse
from contextlib import ExitStack
import hashlib
import json
import math
from pathlib import Path
import subprocess
from time import perf_counter

import cv2
import mediapipe as mp

from import_popsign_development import archived_recordings, signer_key


ASSETS = Path("public/vision/models")
MODEL_FILES = ("gesture_recognizer.task", "face_landmarker.task", "pose_landmarker_lite.task")
FACE_INDICES = (0, 4, 10, 13, 14, 17, 33, 61, 70, 105, 133, 145, 159, 263, 291, 300, 334, 362, 374, 386)
RAW = Path("evaluation/raw")
VIDEOS = Path("evaluation/videos")


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def points(landmarks):
    return [
        {"x": p.x, "y": p.y, "z": p.z, **({"visibility": p.visibility} if p.visibility is not None else {})}
        for p in landmarks
    ]


def extract(file, sample_fps, landmarker_path=None):
    vision = mp.tasks.vision
    base = mp.tasks.BaseOptions
    inputs = [base(model_asset_path=str(ASSETS / name), delegate=base.Delegate.CPU) for name in MODEL_FILES]
    video = vision.RunningMode.VIDEO
    camera = cv2.VideoCapture(str(file), cv2.CAP_FFMPEG)
    face, pose = [], []
    frames = []
    tracking_ms = []
    previous_pts = -1
    previous_aux = -150
    since_aux = 2
    next_sample = 1000 / sample_fps
    count = 0
    try:
        if not camera.isOpened():
            raise ValueError("OpenCV could not decode MP4")
        expected = int(camera.get(cv2.CAP_PROP_FRAME_COUNT))
        source_fps = camera.get(cv2.CAP_PROP_FPS)
        if not math.isfinite(source_fps) or source_fps <= 0 or not 0 < expected / source_fps <= 30:
            raise ValueError("Invalid or unsupported source duration")
        with ExitStack() as stack:
            hand_options = dict(running_mode=video, num_hands=2, min_hand_detection_confidence=0.55,
                                min_hand_presence_confidence=0.55, min_tracking_confidence=0.55)
            if landmarker_path:
                hands = stack.enter_context(vision.HandLandmarker.create_from_options(
                    vision.HandLandmarkerOptions(base_options=base(model_asset_path=str(landmarker_path),
                                                                   delegate=base.Delegate.CPU), **hand_options)))
                run_hands = hands.detect_for_video
            else:
                hands = stack.enter_context(vision.GestureRecognizer.create_from_options(
                    vision.GestureRecognizerOptions(base_options=inputs[0], **hand_options,
                        canned_gesture_classifier_options=mp.tasks.components.processors.ClassifierOptions(score_threshold=0.55))))
                run_hands = hands.recognize_for_video
            faces = stack.enter_context(vision.FaceLandmarker.create_from_options(
                vision.FaceLandmarkerOptions(base_options=inputs[1], running_mode=video,
                    min_face_detection_confidence=0.55, min_face_presence_confidence=0.55, min_tracking_confidence=0.55)))
            poses = stack.enter_context(vision.PoseLandmarker.create_from_options(
                vision.PoseLandmarkerOptions(base_options=inputs[2], running_mode=video,
                    min_pose_detection_confidence=0.55, min_pose_presence_confidence=0.55, min_tracking_confidence=0.55)))
            while True:
                ok, image = camera.read()
                if not ok:
                    break
                count += 1
                pts = camera.get(cv2.CAP_PROP_POS_MSEC)
                if not math.isfinite(pts) or pts <= previous_pts:
                    raise ValueError("Decoder returned non-monotonic presentation timestamps")
                previous_pts = pts
                if pts + 0.01 < next_sample:
                    continue
                while next_sample <= pts + 0.01:
                    next_sample += 1000 / sample_fps
                timestamp = round(pts)
                rgb = mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(image, cv2.COLOR_BGR2RGB))
                start = perf_counter()
                result = run_hands(rgb, timestamp)
                since_aux += 1
                if since_aux >= 2 and timestamp - previous_aux >= 150:
                    f = faces.detect_for_video(rgb, timestamp).face_landmarks
                    p = poses.detect_for_video(rgb, timestamp).pose_landmarks
                    face = points([f[0][index] for index in FACE_INDICES]) if f else []
                    pose = points(p[0]) if p else []
                    previous_aux, since_aux = timestamp, 0
                tracking_ms.append((perf_counter() - start) * 1000)
                frames.append({"timestamp": timestamp, "face": face, "pose": pose, "hands": [
                    {"landmarks": points(landmarks), "handedness": side[0].category_name if side else "Unknown",
                     "gesture": "None", "gestureScore": 0}
                    for landmarks, side in zip(result.hand_landmarks, result.handedness, strict=True)
                ]})
        if not frames or count < expected - 2:
            raise ValueError(f"Incomplete decode: {count} of {expected} source frames")
        return frames, {
            "duration_s": expected / source_fps,
            "source_fps": source_fps,
            "tracked_frames": sum(bool(frame["hands"]) for frame in frames),
            "median_tracking_ms": sorted(tracking_ms)[len(tracking_ms) // 2],
        }
    finally:
        camera.release()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--fps", type=int, choices=(10, 15, 20, 30), default=20)
    parser.add_argument("--hand-landmarker", type=Path, help="Local Hand Landmarker Task asset for a paired diagnostic")
    parser.add_argument("--resume", action="store_true", help="Retry failed or missing files after the previous extraction stopped")
    args = parser.parse_args()
    if not args.output.resolve().is_relative_to(RAW.resolve()) or args.output.resolve() == RAW.resolve():
        parser.error("raw landmarks must stay under ignored evaluation/raw/")
    rows = json.loads(args.manifest.read_text(encoding="utf-8"))
    if not rows:
        raise ValueError("Empty development manifest")
    sealed, sealed_hashes, _ = archived_recordings()
    for row in rows:
        file = Path(row["file"]).resolve()
        if row["language"] != "asl" or row["evaluation_split"] != "development" or not file.is_relative_to(VIDEOS.resolve()):
            raise ValueError("Only local ASL development recordings are supported")
        if signer_key(row["participant_id"]) in sealed or row["recording_sha256"] in sealed_hashes:
            raise ValueError("Sealed recording or signer")
        if sha256(file) != row["recording_sha256"]:
            raise ValueError(f"Video SHA-256 mismatch: {row['trial_id']}")
    for field in ("recording_sha256", "trial_id"):
        if len({row[field] for row in rows}) != len(rows):
            raise ValueError(f"Duplicate {field}")
    metadata = {"protocol": "native-tasks-video-v1", "manifest_sha256": sha256(args.manifest), "sample_fps": args.fps,
        "mediapipe": mp.__version__, "opencv": cv2.__version__, "assets": {name: sha256(ASSETS / name) for name in MODEL_FILES},
        "source_commit": subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip(),
        "extractor_sha256": sha256(Path(__file__))}
    if args.hand_landmarker:
        metadata["assets"].pop(MODEL_FILES[0])
        metadata["assets"]["hand_landmarker.task"] = sha256(args.hand_landmarker)
    runtime_path = args.output / "runtime.json"
    args.output.mkdir(parents=True, exist_ok=args.resume)
    if args.resume:
        prior = json.loads(runtime_path.read_text(encoding="utf-8"))
        for key in ("protocol", "manifest_sha256", "sample_fps", "mediapipe", "opencv", "assets"):
            if prior[key] != metadata[key]:
                raise ValueError(f"Resume configuration differs: {key}")
        prior.setdefault("resume_extractors", []).append({"source_commit": metadata["source_commit"], "sha256": metadata["extractor_sha256"]})
        metadata = prior
    runtime_path.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    failed = 0
    for row in rows:
        record = {"trial_id": row["trial_id"], "recording_sha256": row["recording_sha256"]}
        target = args.output / (record["recording_sha256"] + ".json")
        if args.resume and target.exists():
            cached = json.loads(target.read_text(encoding="utf-8"))
            if any(cached[key] != value for key, value in record.items()):
                raise ValueError("Cached trace identity differs")
            if cached["status"] == "complete":
                continue
        try:
            record["frames"], record["quality"] = extract(row["file"], args.fps, args.hand_landmarker)
            record["status"] = "complete"
        except (OSError, ValueError, RuntimeError) as error:
            record.update(status="error", error=str(error))
            failed += 1
        temp = target.with_suffix(".tmp")
        temp.write_text(json.dumps(record, allow_nan=False), encoding="utf-8")
        temp.replace(target)
        print(json.dumps({key: value for key, value in record.items() if key != "frames"}), flush=True)
    if failed:
        raise SystemExit(f"{failed} recordings failed extraction. Resolve or report before using results.")


if __name__ == "__main__":
    main()
