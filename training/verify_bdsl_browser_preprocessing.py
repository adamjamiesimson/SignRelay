"""Compare production TypeScript packing with the publisher's PyTorch transform.

Uses all six pinned publisher clips; no synthetic fixture is counted as accuracy.
Raw frames and tensors remain in work/, while the JSON report can be committed.
"""
from pathlib import Path
import argparse
import json
import subprocess

from export_bdsl401_onnx import CLIPS, digest, read_clip


def main():
    import cv2
    import numpy as np
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("clips", type=Path)
    parser.add_argument("--output", type=Path, default=Path("work/bdsl-browser-preprocessing"))
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    output = args.output.resolve()
    if not output.is_relative_to(root / "work"):
        raise ValueError("Fixtures must remain under work/")
    output.mkdir(parents=True, exist_ok=True)
    cli = output / "pack.mjs"
    subprocess.run([str(root / "node_modules/.bin/esbuild"), "scripts/pack-bdsl-frames.ts", "--bundle", "--platform=node", "--format=esm", f"--outfile={cli}"], check=True, cwd=root)
    results = []
    for filename, expected_hash in CLIPS.items():
        clip = args.clips / filename
        if digest(clip) != expected_hash:
            raise ValueError(f"Clip mismatch: {filename}")
        folder = output / clip.stem
        folder.mkdir(exist_ok=True)
        capture = cv2.VideoCapture(str(clip))
        frames, index = [], 0
        try:
            while True:
                ok, frame = capture.read()
                if not ok:
                    break
                if index % 10 == 0:
                    rgba = cv2.cvtColor(frame, cv2.COLOR_BGR2RGBA)
                    name = f"frame-{index:04d}.rgba"
                    rgba.tofile(folder / name)
                    frames.append({"path": name, "width": int(rgba.shape[1]), "height": int(rgba.shape[0])})
                index += 1
        finally:
            capture.release()
        manifest = folder / "frames.json"
        manifest.write_text(json.dumps({"frames": frames}))
        target = folder / "typescript.f32"
        subprocess.run(["node", str(cli), str(manifest), str(target)], check=True, cwd=root)
        actual = np.fromfile(target, dtype="<f4")
        expected, _ = read_clip(clip)
        np.testing.assert_allclose(actual, expected.flatten(), rtol=2e-5, atol=2e-5)
        record = {"file": filename, "clipSha256": expected_hash, "frames": len(frames), "values": len(actual), "maxAbsError": float(np.abs(actual - expected.flatten()).max()), "passed": True}
        results.append(record)
        print(json.dumps(record), flush=True)
    (output / "verification.json").write_text(json.dumps({"typescriptSha256": digest(root / "lib/bdsl-video.ts"), "reference": "Pinned publisher transform: RGB, every tenth frame, truncating temporal sampling, ImageNet normalization, bilinear antialias full-frame resize", "rtol": 2e-5, "atol": 2e-5, "clips": results, "passed": True}, indent=2) + "\n")


if __name__ == "__main__":
    main()
