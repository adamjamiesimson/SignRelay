"""Export AI4Bharat's INCLUDE-263 landmark transformer to browser ONNX.

The input contract is 200 frames x 134 coordinates: 25 body landmarks plus
two 21-point hands, with x/y coordinates.  This intentionally exports the
published small model without retraining or relabelling it.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import torch
from torch import Tensor, nn
from torch.nn import functional as F


class PositionEmbedding(nn.Module):
    def __init__(self, hidden_size: int, max_positions: int = 256) -> None:
        super().__init__()
        self.position_embeddings = nn.Embedding(max_positions, hidden_size)
        self.LayerNorm = nn.LayerNorm(hidden_size, eps=1e-12)
        self.register_buffer("position_ids", torch.arange(max_positions).expand((1, -1)))

    def forward(self, values: Tensor) -> Tensor:
        positions = self.position_ids[:, :values.size(1)]
        return self.LayerNorm(values + self.position_embeddings(positions))


class BertSelfAttention(nn.Module):
    def __init__(self, hidden_size: int = 256, heads: int = 4) -> None:
        super().__init__()
        self.query = nn.Linear(hidden_size, hidden_size)
        self.key = nn.Linear(hidden_size, hidden_size)
        self.value = nn.Linear(hidden_size, hidden_size)
        self.heads = heads
        self.head_size = hidden_size // heads

    def forward(self, values: Tensor) -> Tensor:
        batch, frames, _ = values.shape
        def split(projection: Tensor) -> Tensor:
            return projection.view(batch, frames, self.heads, self.head_size).transpose(1, 2)
        query, key, value = split(self.query(values)), split(self.key(values)), split(self.value(values))
        scores = torch.matmul(query, key.transpose(-1, -2)) / (self.head_size ** 0.5)
        context = torch.matmul(torch.softmax(scores, dim=-1), value)
        return context.transpose(1, 2).contiguous().view(batch, frames, self.heads * self.head_size)


class BertAttention(nn.Module):
    def __init__(self) -> None:
        super().__init__()
        self.self = BertSelfAttention()
        self.output = nn.Module()
        self.output.dense = nn.Linear(256, 256)
        self.output.LayerNorm = nn.LayerNorm(256, eps=1e-12)

    def forward(self, values: Tensor) -> Tensor:
        return self.output.LayerNorm(self.output.dense(self.self(values)) + values)


class BertLayer(nn.Module):
    def __init__(self) -> None:
        super().__init__()
        self.attention = BertAttention()
        self.intermediate = nn.Module()
        self.intermediate.dense = nn.Linear(256, 3072)
        self.output = nn.Module()
        self.output.dense = nn.Linear(3072, 256)
        self.output.LayerNorm = nn.LayerNorm(256, eps=1e-12)

    def forward(self, values: Tensor) -> Tensor:
        attended = self.attention(values)
        transformed = self.output.dense(F.gelu(self.intermediate.dense(attended)))
        return self.output.LayerNorm(transformed + attended)


class IncludeTransformer(nn.Module):
    def __init__(self, classes: int = 263) -> None:
        super().__init__()
        self.l1 = nn.Linear(134, 256)
        self.embedding = PositionEmbedding(256)
        self.layers = nn.ModuleList([BertLayer(), BertLayer()])
        self.l2 = nn.Linear(256, classes)

    def forward(self, values: Tensor) -> Tensor:
        values = self.embedding(self.l1(values))
        for layer in self.layers:
            values = layer(values)
        return self.l2(torch.amax(values, dim=1))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("checkpoint", type=Path)
    parser.add_argument("label_map", type=Path)
    parser.add_argument("--output", type=Path, default=Path("public/models/isl263-include"))
    args = parser.parse_args()

    checkpoint = torch.load(args.checkpoint, map_location="cpu", weights_only=False)
    model = IncludeTransformer().eval()
    model.load_state_dict(checkpoint["model"], strict=True)
    args.output.mkdir(parents=True, exist_ok=True)

    sample = torch.zeros((1, 200, 134), dtype=torch.float32)
    torch.onnx.export(
        model,
        sample,
        args.output / "model.onnx",
        input_names=["landmarks"],
        output_names=["logits"],
        opset_version=17,
        dynamo=False,
    )
    labels_by_name = json.loads(args.label_map.read_text(encoding="utf-8"))
    labels = [None] * len(labels_by_name)
    for name, index in labels_by_name.items():
        labels[index] = name.upper()
    if len(labels) != 263 or any(label is None for label in labels):
        raise ValueError("Expected the official 263-label INCLUDE map")
    (args.output / "labels.json").write_text(json.dumps(labels, indent=2), encoding="utf-8")
    (args.output / "model.json").write_text(json.dumps({
        "format": "onnx",
        "modelVersion": "include263-small-transformer-official-v1",
        "language": "ISL",
        "classes": 263,
        "sequenceLength": 200,
        "inputFeatures": 134,
        "inputName": "landmarks",
        "outputName": "logits",
        "source": {
            "dataset": "AI4Bharat INCLUDE",
            "architecture": "Small landmark transformer",
            "checkpoint": "include_no_cnn_transformer_small",
        },
    }, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
