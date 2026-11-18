"""Build a local 30 Hz camera reel from the guarded 12-clip development probe."""
import argparse
import json
from pathlib import Path
import sys

import cv2
import numpy as np

from pixels import digest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "training"))
from import_popsign_development import archived_recordings, signer_key


def build(root, target, indexed):
    width, height, fps = 480, 640, 30
    blank = cv2.cvtColor(np.full((height, width, 3), 127, np.uint8), cv2.COLOR_BGR2YUV_I420).tobytes()
    frame_count = 0
    trials = []
    reserved, hashes, _ = archived_recordings()

    with target.open("xb") as raw:
        raw.write(f"YUV4MPEG2 W{width} H{height} F{fps}:1 Ip A1:1 C420\n".encode())

        def emit(pixels):
            nonlocal frame_count
            raw.write(b"FRAME\n")
            raw.write(pixels)
            frame_count += 1

        for _ in range(fps * 2):
            emit(blank)
        for item in indexed:
            asset = (root / item["file"]).resolve()
            if (item["evaluation_split"] != "development" or not asset.is_relative_to((root / "evaluation/videos").resolve())
                    or signer_key(item["participant_id"]) in reserved or item["recording_sha256"] in hashes
                    or digest(asset) != item["recording_sha256"]):
                raise ValueError("Only original guarded development clips can enter the reel")
            capture = cv2.VideoCapture(str(asset), cv2.CAP_FFMPEG, [cv2.CAP_PROP_N_THREADS, 1])
            start = frame_count
            try:
                actual_fps = capture.get(cv2.CAP_PROP_FPS)
                step = round(actual_fps / fps)
                if not capture.isOpened() or step < 1 or abs(actual_fps - fps * step) > 0.5:
                    raise ValueError("Reel requires source footage near an integer multiple of 30 fps")
                index = 0
                while True:
                    ok, frame = capture.read()
                    if not ok:
                        break
                    take = index % step == 0
                    index += 1
                    if not take:
                        continue
                    h, w = frame.shape[:2]
                    # Letterbox unusual aspect ratios. Leave 3:4 clips untouched.
                    scale = min(width / w, height / h)
                    sw, sh = round(w * scale), round(h * scale)
                    padded = np.full((height, width, 3), 127, np.uint8)
                    x, y = (width - sw) // 2, (height - sh) // 2
                    padded[y:y + sh, x:x + sw] = cv2.resize(frame, (sw, sh), interpolation=cv2.INTER_AREA)
                    emit(cv2.cvtColor(padded, cv2.COLOR_BGR2YUV_I420).tobytes())
            finally:
                capture.release()
            if frame_count <= start:
                raise ValueError("Empty development clip")
            trials.append({"label": item["expected_gloss"], "kind": item["role_in_candidate"],
                           "startMs": 1000 * start / fps, "endMs": 1000 * frame_count / fps,
                           "frames": frame_count - start, "sourceFps": actual_fps, "sourceFrames": index,
                           "sha256": item["recording_sha256"]})
            for _ in range(fps * 2):
                emit(blank)
    return {"fps": fps, "frames": frame_count, "sha256": digest(target), "trials": trials,
            "durationSeconds": frame_count / fps}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source_checkout", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("index", type=Path)
    args = parser.parse_args()
    if not args.output.resolve().is_relative_to(Path("evaluation/raw").resolve()) or args.output.suffix != ".y4m":
        parser.error("Write derived footage only to ignored evaluation/raw")
    dataset = args.source_checkout / "evaluation/derived/popsign-rebirth-v1"
    manifest = {row["recording_sha256"]: row for row in json.loads((dataset / "val.json").read_text(encoding="utf-8"))}
    probe = json.loads((dataset / "browser-probe.json").read_text(encoding="utf-8"))
    rows = [manifest[row["recording_sha256"]] for row in probe]
    args.index.write_text(json.dumps(build(args.source_checkout, args.output, rows), indent=2), encoding="utf-8")
