"""Compare original and file-backed-camera pixels with the pinned native tracker."""
import argparse
import json
from pathlib import Path

import cv2

from pixels import HAND_HASH, POSE_HASH, NativeTracker, digest


def probe(path, start, frames, assets):
    camera = cv2.VideoCapture(str(path), cv2.CAP_FFMPEG, [cv2.CAP_PROP_N_THREADS, 1])
    tracker = NativeTracker(*assets)
    try:
        if not camera.isOpened():
            raise ValueError("Video could not open")
        fps = camera.get(cv2.CAP_PROP_FPS)
        if not 0 < fps <= 120:
            raise ValueError("Invalid source cadence")
        for _ in range(start):
            if not camera.grab():
                raise ValueError("Video ended before active sign")
        tracked = usable = 0
        for i in range(frames):
            ok, image = camera.read()
            if not ok:
                raise ValueError("Video ended inside active sign")
            height, width = image.shape[:2]
            scale = min(1, 640 / max(width, height))
            scaled = cv2.resize(image, (int(width * scale + 0.5), int(height * scale + 0.5)))
            observation = tracker.run(scaled, round(i * 1000 / fps))
            tracked += bool(observation["hands"])
            usable += any(0 <= hand["landmarks"][0]["x"] <= 1 and 0 <= hand["landmarks"][0]["y"] <= 1
                          for hand in observation["hands"])
        return {"width": width, "height": height, "sourceFps": fps, "frames": frames, "detected": tracked, "usable": usable}
    finally:
        tracker.close()
        camera.release()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("intake", type=Path)
    parser.add_argument("recording")
    parser.add_argument("fixture", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--assets", required=True, nargs=2)
    parser.add_argument("--fixture-start", required=True, type=int)
    parser.add_argument("--frames", required=True, type=int)
    args = parser.parse_args()
    if [digest(path) for path in args.assets] != [HAND_HASH, POSE_HASH]:
        parser.error("V2 tracker inputs fail integrity verification")
    if args.fixture_start < 0 or not 1 <= args.frames <= 450:
        parser.error("Invalid active interval")
    intake = json.loads(args.intake.read_text(encoding="utf-8"))
    path = next(Path(row["file"]) for row in intake if row["sha256"] == args.recording)
    if digest(path) != args.recording or not args.fixture.resolve().is_relative_to(Path("evaluation/raw").resolve()):
        parser.error("Use the original guarded input and a local generated fixture")
    results = {
        "protocol": "native hand detector on decoded pixels at source cadence, fresh tracker per input",
        "original": probe(path, 0, args.frames, args.assets),
        "cameraFixture": probe(args.fixture, args.fixture_start, args.frames, args.assets),
        "cameraFixtureSha256": digest(args.fixture),
    }
    args.output.write_text(json.dumps(results, indent=2), encoding="utf-8")
    print(json.dumps(results))
