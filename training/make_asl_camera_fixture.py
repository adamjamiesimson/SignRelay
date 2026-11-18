"""Convert one authorized development clip into a local Chromium fake-camera file."""

import argparse
import hashlib
import json
from pathlib import Path

import cv2
import numpy as np

from import_popsign_development import archived_recordings, signer_key


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("trial")
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    allowed = Path("evaluation/raw").resolve()
    if not args.output.resolve().is_relative_to(allowed) or args.output.suffix != ".y4m":
        parser.error("Write Y4M only in ignored evaluation/raw")
    row = next(row for row in json.loads(args.manifest.read_text(encoding="utf-8")) if row["trial_id"] == args.trial)
    sealed, hashes, _ = archived_recordings()
    file = Path(row["file"]).resolve()
    if row["evaluation_split"] != "development" or row["recording_sha256"] in hashes or signer_key(row["participant_id"]) in sealed:
        raise ValueError("Use a non-reserved development recording")
    if not file.is_relative_to(Path("evaluation/videos").resolve()) or hashlib.sha256(file.read_bytes()).hexdigest() != row["recording_sha256"]:
        raise ValueError("Development recording fingerprint differs")
    camera = cv2.VideoCapture(str(file), cv2.CAP_FFMPEG)
    try:
        width = int(camera.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(camera.get(cv2.CAP_PROP_FRAME_HEIGHT))
        fps = round(camera.get(cv2.CAP_PROP_FPS))
        size = int(camera.get(cv2.CAP_PROP_FRAME_COUNT))
        if not 0 < fps <= 60 or not 1 <= size <= fps * 30 or not width or not height:
            raise ValueError("Invalid input video")
        scale = min(1, 640 / max(width, height))
        width, height = int(width * scale) // 2 * 2, int(height * scale) // 2 * 2
        blank = cv2.cvtColor(np.full((height, width, 3), 127, dtype=np.uint8), cv2.COLOR_BGR2YUV_I420).tobytes()
        with args.output.open("xb") as output:
            output.write(f"YUV4MPEG2 W{width} H{height} F{fps}:1 Ip A1:1 C420\n".encode())
            for _ in range(fps * 12):
                output.write(b"FRAME\n" + blank)
            count = 0
            while True:
                ok, frame = camera.read()
                if not ok:
                    break
                count += 1
                resized = cv2.resize(frame, (width, height), interpolation=cv2.INTER_AREA)
                output.write(b"FRAME\n" + cv2.cvtColor(resized, cv2.COLOR_BGR2YUV_I420).tobytes())
            if count < size - 2:
                raise ValueError("Incomplete recording decode")
            for _ in range(fps * 6):
                output.write(b"FRAME\n" + blank)
        print(json.dumps({"source_sha256": row["recording_sha256"], "width": width, "height": height,
                          "fps": fps, "clip_frames": count, "pre_roll_s": 12, "post_roll_s": 6}))
    finally:
        camera.release()


if __name__ == "__main__":
    main()
