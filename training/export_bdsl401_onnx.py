"""Verify and export the publisher's BdSLW401 VideoMAE for local research.

Preserves numbered class IDs. Does not install a readable translation model.
The preprocessing follows the publisher's video demo, not the generic image
processor's center crop. All source files and generated weights stay in work/.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import time

SOURCE = "Shawon16/VideoMAE_BdSLW401_20_epochs_p5_SR_10"
REVISION = "f03fdadb20d1c59989ee7b2bfa95a07459b7fb56"
HASHES = {
    "model.safetensors": "e8f0e51df603dc2969c2d602dc8b8ee8f2c0e615afdcf903287336012a03a112",
    "config.json": "552490518ff3de4264fdda33f8b7081601fd46759e2aa64dcb317927cb54a96b",
    "preprocessor_config.json": "4bc9b255ff212041bc28127d4fa0ae1630abca52bb2d882f3e4c0b9e5b763f06",
    "README.md": "bc2e5d2801318bfa7f3af5321e33cb044f865e270d87c8f205244e4cb108ca7a",
}
SPACE = "https://huggingface.co/spaces/Shawon16/BdSLW60"
SPACE_REVISION = "50f72af4a9e00ca736d1b345f4d42a5e1740ca68"
CLIPS = {
    "W002S08F_03.mp4": "458f4e951650394059f29092340e26620825fc0fd52e1bbc691705482ddb4adf",
    "W003S08F_11.mp4": "62fb84edbe6ee196d1a4ce71c96836596431a6b7991767ef1034ffa6532703c6",
    "W205S08F_02.mp4": "aeab2353d5b69e797780ec1e1535d2b0d793e4fbdc0e18b73d07f5b1d0c248d9",
    "W211S04F_03.mp4": "57fafb651ac5d0216f1c1632e88658a7871e467abec112a0df85bb9721c2c779",
    "W389S08F_02.mp4": "97e715ef03b35cab865f4c0b2f945983b7b1817370e7749e2acf7ef7fcd84dfc",
    "W401S04F_06.mp4": "f2d27fe6031263d0007039d5b686876aeeb296a018eee8c18b2879c6ffba10e5",
}


def digest(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def ordered_codes(config: dict) -> list[str]:
    labels = config["id2label"]
    if set(labels) != {str(i) for i in range(401)}:
        raise ValueError("Expected exactly 401 contiguous classifier outputs")
    ordered = [labels[str(i)] for i in range(401)]
    if ordered != [f"W{i:03d}" for i in range(1, 402)]:
        raise ValueError("Unexpected BdSLW401 class order")
    if config["label2id"] != {label: i for i, label in enumerate(ordered)}:
        raise ValueError("Inverse label map does not match classifier outputs")
    return ordered


def temporal_indices(frame_count: int):
    """UniformTemporalSubsample uses linspace then truncation, not rounding."""
    import torch
    if frame_count < 1:
        raise ValueError("A nonempty isolated-sign clip is required")
    return torch.linspace(0, frame_count - 1, 16).clamp(0, frame_count - 1).long()


def prepare_frames(frames):
    """Input: RGB uint8 [T,H,W,3], already sampled at every tenth frame."""
    import numpy as np
    import torch
    from torch.nn.functional import interpolate
    frames = np.asarray(frames)
    if frames.ndim != 4 or frames.shape[-1] != 3 or frames.dtype != np.uint8:
        raise ValueError("Expected RGB uint8 video frames")
    if min(frames.shape[:3]) < 1:
        raise ValueError("Empty video dimensions")
    video = torch.from_numpy(frames).index_select(0, temporal_indices(len(frames)))
    video = video.permute(0, 3, 1, 2).float() / 255.0
    mean = torch.tensor([0.485, 0.456, 0.406]).view(1, 3, 1, 1)
    std = torch.tensor([0.229, 0.224, 0.225]).view(1, 3, 1, 1)
    video = (video - mean) / std
    # torchvision Resize((224,224)) on tensors, explicit modern antialias default.
    video = interpolate(video, size=(224, 224), mode="bilinear", align_corners=False, antialias=True)
    return video.unsqueeze(0).contiguous().numpy()


def read_clip(path: Path):
    import cv2
    import numpy as np
    capture = cv2.VideoCapture(str(path))
    if not capture.isOpened():
        raise ValueError(f"Cannot decode clip: {path.name}")
    frames, index = [], 0
    try:
        while True:
            ok, frame = capture.read()
            if not ok:
                break
            if index % 10 == 0:
                frames.append(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
            index += 1
            if index > 1800:
                raise ValueError("Expected an isolated-sign clip, at most 1800 source frames")
    finally:
        capture.release()
    if not frames:
        raise ValueError("Video has no decodable frames")
    return prepare_frames(np.stack(frames)), index


def export(source: Path, clips: Path, output: Path):
    import numpy as np
    import onnx
    import onnxruntime as ort
    import torch
    import transformers
    from transformers import VideoMAEForVideoClassification
    output = output.resolve()
    root = Path(__file__).resolve().parents[1]
    if any(output.is_relative_to(root / name) for name in ("public", "out")):
        raise ValueError("Research export must stay outside public/ and out/")
    for name, expected in HASHES.items():
        if digest(source / name) != expected:
            raise ValueError(f"Pinned source mismatch: {name}")
    labels = ordered_codes(json.loads((source / "config.json").read_text()))
    for name, expected in CLIPS.items():
        if digest(clips / name) != expected:
            raise ValueError(f"Pinned clip mismatch: {name}")
    torch.set_num_threads(2)
    model, loading = VideoMAEForVideoClassification.from_pretrained(
        str(source), local_files_only=True, use_safetensors=True,
        attn_implementation="eager", output_loading_info=True)
    if any(loading.get(key) for key in ("missing_keys", "unexpected_keys", "mismatched_keys", "error_msgs")):
        raise ValueError(f"Checkpoint did not load exactly: {loading}")
    if (model.config.num_frames, model.config.image_size, model.config.num_labels) != (16, 224, 401):
        raise ValueError("Wrong model input/output contract")
    model.eval()

    class Classifier(torch.nn.Module):
        def __init__(self):
            super().__init__()
            self.model = model

        def forward(self, pixel_values):
            return self.model(pixel_values=pixel_values).logits

    wrapped = Classifier().eval()
    output.mkdir(parents=True, exist_ok=True)
    pending = output / "model.pending.onnx"
    first, _ = read_clip(clips / next(iter(CLIPS)))
    try:
        with torch.no_grad():
            torch.onnx.export(wrapped, (torch.from_numpy(first),), str(pending),
                              input_names=["pixel_values"], output_names=["logits"],
                              opset_version=17, dynamo=False)
        onnx.checker.check_model(str(pending))
        options = ort.SessionOptions()
        options.intra_op_num_threads = 2
        session = ort.InferenceSession(str(pending), options, providers=["CPUExecutionProvider"])
        results = []
        for name in CLIPS:
            inputs, source_frames = read_clip(clips / name)
            with torch.no_grad():
                expected = wrapped(torch.from_numpy(inputs)).numpy()
            started = time.perf_counter()
            actual = session.run(["logits"], {"pixel_values": inputs})[0]
            elapsed_ms = round((time.perf_counter() - started) * 1000)
            if actual.shape != (1, 401) or not np.isfinite(actual).all():
                raise ValueError("Invalid exported model output")
            np.testing.assert_allclose(actual, expected, atol=2e-4, rtol=2e-4)
            top5 = [labels[i] for i in np.argsort(-actual[0], kind="stable")[:5]]
            entry = {"file": name, "sha256": CLIPS[name], "sourceFrames": source_frames,
                     "expectedCode": name[:4], "top5": top5, "top1Correct": top5[0] == name[:4],
                     "top5Correct": name[:4] in top5, "nativeInferenceMs": elapsed_ms,
                     "maxAbsLogitError": float(np.max(np.abs(expected - actual)))}
            print(json.dumps(entry), flush=True)
            results.append(entry)
            if name == next(iter(CLIPS)):
                inputs.astype("<f4").tofile(output / "wasm-input.f32")
                expected.astype("<f4").tofile(output / "wasm-expected.f32")
        pending.replace(output / "model.onnx")
        (output / "class-codes.json").write_text(json.dumps(labels, indent=2) + "\n")
        report = {
            "source": f"https://huggingface.co/{SOURCE}/tree/{REVISION}",
            "sourceHashes": HASHES, "clipSource": f"{SPACE}/tree/{SPACE_REVISION}",
            "selection": "All six standalone demo MP4s; selected before inference; publisher-selected examples",
            "modelSha256": digest(output / "model.onnx"), "modelBytes": (output / "model.onnx").stat().st_size,
            "input": [1, 16, 3, 224, 224], "output": [1, 401],
            "preprocessing": "Every tenth decoded RGB frame, uniform 16-frame selection with truncation, divide by 255, ImageNet normalization, bilinear square resize with antialiasing",
            "clips": results, "top1Count": sum(r["top1Correct"] for r in results),
            "top5Count": sum(r["top5Correct"] for r in results), "total": len(results),
            "versions": {"torch": torch.__version__, "transformers": transformers.__version__,
                         "onnx": onnx.__version__, "onnxruntime": ort.__version__},
            "installed": False, "readableVocabularyVerified": False,
            "limitations": "Class-code smoke test on six publisher-selected clips, not a general accuracy benchmark; no live camera or browser verification; readable Bangla mapping missing",
        }
        (output / "verification.json").write_text(json.dumps(report, indent=2) + "\n")
        return report
    finally:
        pending.unlink(missing_ok=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("clips", type=Path)
    parser.add_argument("--output", type=Path, default=Path("work/bdsl401-export"))
    args = parser.parse_args()
    export(args.source, args.clips, args.output)
