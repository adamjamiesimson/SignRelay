"""Compare the production TypeScript transform with the SWL-LSE training reader.

Controlled landmarks exercise contracts only; they are not accuracy fixtures.
"""
import json
from pathlib import Path
import subprocess
from types import SimpleNamespace

import numpy as np
from train_swl_lse_onnx import sequence_from_release


def main():
    root = Path(__file__).resolve().parents[1]
    work = root / "work/lse-preprocessing"
    work.mkdir(parents=True, exist_ok=True)
    clips, expected, names = [], [], []
    for size, missing in [(1, "none"), (30, "left"), (64, "none"), (80, "none"), (137, "shoulders"), (24, "all")]:
        frames, release = [], []
        for i in range(size):
            pose = [dict(x=float(np.float32(.3 + j * .007)), y=float(np.float32(.4 + i * .0001)), z=float(np.float32(j * .002))) for j in range(33)]
            hands = []
            for side, offset in [("Left", -.1), ("Right", .1)]:
                if missing in ("all", side.lower()):
                    continue
                points = [dict(x=float(np.float32(.5 + offset + i * .001)), y=float(np.float32(.6 - j * .002)), z=float(np.float32(j * .003))) for j in range(21)]
                hands.append(dict(handedness=side, landmarks=points, gesture="None", gestureScore=0))
            if missing == "shoulders":
                pose[11] = pose[12] = dict(x=0., y=0., z=0.)
            if missing == "all":
                pose = []
            frames.append(dict(timestamp=i*40, hands=hands, pose=pose, face=[]))
            def container(points):
                return SimpleNamespace(landmark=[SimpleNamespace(**p) for p in points])
            holistic = {"pose_landmarks": container(pose)}
            for hand in hands:
                holistic[hand["handedness"].lower()+"_hand_landmarks"] = container(hand["landmarks"])
            release.append({"holistic_legacy": holistic})
        clips.append(frames)
        expected.append(sequence_from_release(release))
        names.append(f"{size}-frames-missing-{missing}")
    (work / "input.json").write_text(json.dumps(clips))
    subprocess.run(["npx", "esbuild", "scripts/pack-lse-frames.ts", "--bundle", "--platform=node", "--format=esm", "--external:onnxruntime-web", f"--outfile={work}/pack.mjs"], cwd=root, check=True)
    subprocess.run(["node", str(work/"pack.mjs"), str(work/"input.json"), str(work/"output.f32")], cwd=root, check=True)
    actual = np.fromfile(work/"output.f32", dtype="<f4").reshape(len(clips), 64, 183)
    results = []
    for name, reference, converted in zip(names, expected, actual):
        np.testing.assert_allclose(converted, reference, rtol=1e-5, atol=2e-6)
        results.append({"fixture": name, "maxAbsoluteError": float(np.abs(converted-reference).max()), "passed": True})
    report = {"purpose": "Controlled landmark preprocessing parity, not recognition accuracy", "compared": "production prepareLseInput vs training sequence_from_release", "fixtures": results, "allPassed": True}
    (root/"docs/verification/lse300-browser-preprocessing.json").write_text(json.dumps(report, indent=2)+"\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
