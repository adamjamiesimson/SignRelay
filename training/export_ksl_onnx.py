"""Export the pinned Korean classifier for local research, without app activation."""
from __future__ import annotations
import argparse
import hashlib
import importlib
import json
from pathlib import Path
import sys
import types

SOURCE_REPO = "Seoyoung07/korean-sign-word-classifier-mediapipe"
SOURCE_REVISION = "214c0d87294695f4c79086440404bfb72fa7c5bc"
SOURCE_HASHES = {
    "best.pt": "c1ee1138ac2f2cde81b9f1ce258f6f13d041f0c01050181c7a76e855f6ba9eb6",
    "model/config.py": "0700072f3d408466fca11b385b7859c0dbc369f8a0746f82db762e7d8b5670f5",
    "model/preprocessing.py": "1d35c7f20fd6a88fe77a11380f14bdd4095def61e2919280c6ad2451a7dcb1f3",
    "model/keypoint_ctc.py": "d1edefa47691cc46b71167c5df76476d6f928658ecd24a08b5008b7c2e770b19",
    "model/word_classifier.py": "1c77d676a6e2067e6978bd23203385b3a8e336e0c8be339042267006ebd174ea",
    "label_to_id.json": "b638abdd05f862f2b7e1ea9a9cc7b2e07cd3e36a0639483d5c7a9b01e8502dfc",
}


def sha256(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def verify_source(source: Path) -> None:
    for name, digest in SOURCE_HASHES.items():
        if sha256(source / name) != digest:
            raise ValueError(f"Pinned source checksum mismatch: {name}")


def ordered_labels(mapping: dict) -> list[str]:
    if not mapping or any(type(index) is not int for index in mapping.values()):
        raise ValueError("Expected integer class IDs")
    if sorted(mapping.values()) != list(range(len(mapping))):
        raise ValueError("Class IDs must be contiguous, unique and zero-based")
    labels = sorted(mapping, key=mapping.get)
    if any(not isinstance(label, str) or not label.strip() for label in labels):
        raise ValueError("Class labels must be nonempty strings")
    return labels


def load_source_model(source: Path):
    import torch
    verify_source(source)
    # Import only checksum-verified files, not upstream __init__ or optional
    # video dependencies. Executable pickled checkpoint objects are disallowed.
    package = types.ModuleType("_signrelay_ksl_source")
    package.__path__ = [str(source / "model")]
    sys.modules[package.__name__] = package
    config_module = importlib.import_module(f"{package.__name__}.config")
    model_module = importlib.import_module(f"{package.__name__}.word_classifier")
    checkpoint = torch.load(source / "best.pt", map_location="cpu", weights_only=True)
    mapping = checkpoint["label_to_id"]
    if mapping != json.loads((source / "label_to_id.json").read_text(encoding="utf-8-sig")):
        raise ValueError("External label map differs from trained checkpoint")
    labels = ordered_labels(mapping)
    config = config_module.KeypointCTCConfig(**checkpoint["config"])
    if (len(labels), config.max_frames, config.num_keypoints, config.input_features) != (2946, 64, 115, 16):
        raise ValueError("Unexpected checkpoint contract")
    model = model_module.WordKeypointClassifier(len(labels), config=config)
    model.load_state_dict(checkpoint["model_state"], strict=True)
    return model.eval(), labels, checkpoint


def export(source: Path, output: Path) -> dict:
    import numpy as np
    import onnx
    import onnxruntime as ort
    import torch
    root = Path(__file__).resolve().parents[1]
    output = output.resolve()
    if any(output.is_relative_to(root / p) for p in ("public", "out")):
        raise ValueError("KSL research exports must stay outside public/ and out/")
    model, labels, checkpoint = load_source_model(source.resolve())
    torch.set_num_threads(2)
    torch.backends.mha.set_fastpath_enabled(False)

    class RawModel(torch.nn.Module):
        def __init__(self):
            super().__init__()
            self.model = model

        def forward(self, raw, lengths):
            return self.model.forward_raw(raw, lengths)

    wrapped = RawModel().eval()
    rng = np.random.default_rng(20260914)
    raw = rng.uniform(0.2, 0.8, (1, 64, 115, 4)).astype(np.float32)
    raw[..., 3] = 1
    output.mkdir(parents=True, exist_ok=True)
    path = output / "model.onnx"
    temporary = output / "model.pending.onnx"
    try:
        with torch.no_grad():
            torch.onnx.export(wrapped, (torch.from_numpy(raw), torch.tensor([64])), str(temporary),
                              input_names=["keypoints", "lengths"], output_names=["logits"],
                              opset_version=17, dynamo=False)
        onnx.checker.check_model(str(temporary))
        options = ort.SessionOptions(); options.intra_op_num_threads = 2
        session = ort.InferenceSession(str(temporary), options, providers=["CPUExecutionProvider"])
        results = []
        for length in [1, 17, 64]:
            case = raw.copy(); case[:, length:] = 0
            if length == 17:
                case[:, :5, 13:55] = 0
            lengths = np.array([length], dtype=np.int64)
            with torch.no_grad():
                expected = wrapped(torch.from_numpy(case), torch.from_numpy(lengths)).numpy()
            actual = session.run(["logits"], {"keypoints": case, "lengths": lengths})[0]
            if actual.shape != (1, len(labels)) or not np.isfinite(actual).all():
                raise ValueError("Invalid exported model output")
            np.testing.assert_allclose(actual, expected, rtol=2e-4, atol=2e-4)
            results.append({"length": length, "max_abs_error": float(np.max(np.abs(actual - expected)))})
            case.astype("<f4").tofile(output / f"input-{length}.f32")
            expected.astype("<f4").tofile(output / f"expected-{length}.f32")
        temporary.replace(path)
        (output / "labels.json").write_text(json.dumps(labels, ensure_ascii=False, indent=2) + "\n")
        report = {
            "source": f"https://huggingface.co/{SOURCE_REPO}/tree/{SOURCE_REVISION}",
            "checkpointSha256": SOURCE_HASHES["best.pt"], "modelSha256": sha256(path),
            "modelBytes": path.stat().st_size, "classes": len(labels),
            "epoch": checkpoint["epoch"], "publisherValidationAccuracy": checkpoint["val_acc"],
            "input": {"keypoints": [1, 64, 115, 4], "lengths": [1]}, "output": [1, len(labels)],
            "nativeParity": results, "signAccuracyMeasuredHere": False,
            "releaseStatus": "research-only; model/source reuse terms and signer evaluation unresolved",
            "versions": {"torch": torch.__version__, "onnx": onnx.__version__, "onnxruntime": ort.__version__},
        }
        (output / "verification.json").write_text(json.dumps(report, indent=2) + "\n")
        return report
    finally:
        temporary.unlink(missing_ok=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("--output", type=Path, default=Path("work/ksl2946"))
    args = parser.parse_args()
    print(json.dumps(export(args.source, args.output), indent=2))
