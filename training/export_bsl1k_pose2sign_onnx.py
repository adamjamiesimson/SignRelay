"""Export the official BSL-1K body-and-hands Pose2Sign checkpoint to ONNX."""

from __future__ import annotations

import argparse
import json
import pickle
from pathlib import Path

import torch
from torch import nn


def conv3x3(inputs: int, outputs: int, stride: int = 1) -> nn.Conv2d:
    return nn.Conv2d(inputs, outputs, 3, stride, 1, bias=False)


class BasicBlock(nn.Module):
    def __init__(self, inputs: int, outputs: int, stride: int = 1, downsample: nn.Module | None = None) -> None:
        super().__init__()
        self.conv1 = conv3x3(inputs, outputs, stride)
        self.bn1 = nn.BatchNorm2d(outputs)
        self.relu = nn.ReLU(inplace=True)
        self.conv2 = conv3x3(outputs, outputs)
        self.bn2 = nn.BatchNorm2d(outputs)
        self.downsample = downsample

    def forward(self, values: torch.Tensor) -> torch.Tensor:
        identity = values
        values = self.relu(self.bn1(self.conv1(values)))
        values = self.bn2(self.conv2(values))
        if self.downsample is not None:
            identity = self.downsample(identity)
        return self.relu(values + identity)


class ResNet(nn.Module):
    def __init__(self, classes: int) -> None:
        super().__init__()
        self.inplanes = 3
        self.relu = nn.ReLU(inplace=True)
        self.maxpool = nn.MaxPool2d(kernel_size=3, stride=2, padding=1)
        self.layer1 = self._layer(3, 2)
        self.layer2 = self._layer(128, 2, stride=2)
        self.layer3 = self._layer(256, 2, stride=2)
        self.layer4 = self._layer(512, 2, stride=2)
        self.avgpool = nn.AdaptiveAvgPool2d((1, 1))
        self.fc = nn.Linear(512, classes)
        self.dropout = nn.Dropout(0.5)

    def _layer(self, outputs: int, count: int, stride: int = 1) -> nn.Sequential:
        downsample: nn.Module | None = None
        if stride != 1 or self.inplanes != outputs:
            downsample = nn.Sequential(nn.Conv2d(self.inplanes, outputs, 1, stride, bias=False), nn.BatchNorm2d(outputs))
        layers: list[nn.Module] = [BasicBlock(self.inplanes, outputs, stride, downsample)]
        self.inplanes = outputs
        layers.extend(BasicBlock(self.inplanes, outputs) for _ in range(1, count))
        return nn.Sequential(*layers)

    def forward(self, values: torch.Tensor) -> torch.Tensor:
        values = self.layer1(values)
        values = self.layer2(values)
        values = self.layer3(values)
        values = self.layer4(values)
        values = torch.flatten(self.avgpool(values), 1)
        return self.fc(self.dropout(values))


class Pose2Sign(nn.Module):
    def __init__(self, classes: int) -> None:
        super().__init__()
        self.classification = ResNet(classes)

    def forward(self, values: torch.Tensor) -> torch.Tensor:
        return self.classification(values)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("checkpoint", type=Path)
    parser.add_argument("vocabulary", type=Path)
    parser.add_argument("--output", type=Path, default=Path("public/models/bsl1064-pose2sign"))
    args = parser.parse_args()

    checkpoint = torch.load(args.checkpoint, map_location="cpu", weights_only=False)
    state = checkpoint.get("state_dict", checkpoint.get("model", checkpoint))
    state = {key.removeprefix("module."): value for key, value in state.items()}
    with args.vocabulary.open("rb") as file:
        vocabulary = pickle.load(file)
    labels = vocabulary["words"]
    if len(labels) != 1064:
        raise ValueError(f"Expected BSL-1K's 1064 labels, got {len(labels)}")

    model = Pose2Sign(len(labels)).eval()
    model.load_state_dict(state, strict=True)
    args.output.mkdir(parents=True, exist_ok=True)
    sample = torch.zeros((1, 3, 16, 60), dtype=torch.float32)
    torch.onnx.export(model, sample, args.output / "model.onnx", input_names=["pose"], output_names=["logits"], opset_version=17, dynamo=False)
    (args.output / "labels.json").write_text(json.dumps([str(label).upper() for label in labels], indent=2), encoding="utf-8")
    (args.output / "model.json").write_text(json.dumps({
        "format": "onnx", "modelVersion": "bsl1k-pose2sign-bodyhands-v1", "language": "BSL",
        "classes": 1064, "sequenceLength": 16, "inputFeatures": 60, "inputName": "pose", "outputName": "logits",
        "source": {"dataset": "BSL-1K", "architecture": "Pose2Sign ResNet-18", "checkpoint": "bsl1k_pose2sign_m8_l24_kws8_ps_bodyhands"},
    }, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
