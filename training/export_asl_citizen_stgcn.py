"""Research-only exporter for Microsoft's official ASL Citizen ST-GCN checkpoint.

The upstream baseline code is MIT licensed:
https://github.com/microsoft/ASL-citizen-code

The checkpoint and ASL Citizen dataset are NOT redistributed by this script.
Callers must supply them locally and comply with Microsoft's ASL Citizen terms.
The exporter converts the official 2,731-class checkpoint to float32 ONNX and
verifies numerical/top-1 parity against the original float64 PyTorch model.
"""

from __future__ import annotations

import argparse
import copy
import csv
import hashlib
import json
from pathlib import Path

import numpy as np
import torch
from torch import nn
import torch.nn.functional as F


INWARD_EDGES = [
    [2, 0], [1, 0], [0, 3], [0, 4], [3, 5],
    [4, 6], [5, 7], [6, 17], [7, 8], [7, 9],
    [9, 10], [7, 11], [11, 12], [7, 13], [13, 14],
    [7, 15], [15, 16], [17, 18], [17, 19], [19, 20],
    [17, 21], [21, 22], [17, 23], [23, 24], [17, 25], [25, 26],
]


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def hop_distance(num_nodes: int, edges: list[list[int]], max_hop: int = 1) -> np.ndarray:
    adjacency = np.zeros((num_nodes, num_nodes))
    for i, j in edges:
        adjacency[j, i] = 1
        adjacency[i, j] = 1
    distance = np.full((num_nodes, num_nodes), np.inf)
    transfer = [np.linalg.matrix_power(adjacency, d) for d in range(max_hop + 1)]
    reachable = np.stack(transfer) > 0
    for d in range(max_hop, -1, -1):
        distance[reachable[d]] = d
    return distance


def normalise_digraph(adjacency: np.ndarray) -> np.ndarray:
    degree = np.sum(adjacency, 0)
    inverse = np.zeros_like(adjacency)
    for index in range(len(degree)):
        if degree[index] > 0:
            inverse[index, index] = degree[index] ** -1
    return adjacency @ inverse


def spatial_graph(num_nodes: int = 27, center: int = 0) -> np.ndarray:
    self_edges = [[i, i] for i in range(num_nodes)]
    edges = self_edges + INWARD_EDGES
    distance = hop_distance(num_nodes, edges, max_hop=1)
    adjacency = np.zeros((num_nodes, num_nodes))
    for hop in (0, 1):
        adjacency[distance == hop] = 1
    normalised = normalise_digraph(adjacency)

    partitions: list[np.ndarray] = []
    for hop in (0, 1):
        root = np.zeros((num_nodes, num_nodes))
        close = np.zeros((num_nodes, num_nodes))
        further = np.zeros((num_nodes, num_nodes))
        for i in range(num_nodes):
            for j in range(num_nodes):
                if distance[j, i] != hop:
                    continue
                if distance[j, center] == distance[i, center]:
                    root[j, i] = normalised[j, i]
                elif distance[j, center] > distance[i, center]:
                    close[j, i] = normalised[j, i]
                else:
                    further[j, i] = normalised[j, i]
        if hop == 0:
            partitions.append(root)
        else:
            partitions.extend([root + close, further])
    return np.stack(partitions)


class ConvTemporalGraphical(nn.Module):
    def __init__(self, in_channels: int, out_channels: int, kernel_size: int):
        super().__init__()
        self.kernel_size = kernel_size
        self.conv = nn.Conv2d(in_channels, out_channels * kernel_size, kernel_size=(1, 1))

    def forward(self, x: torch.Tensor, adjacency: torch.Tensor):
        x = self.conv(x)
        n, kc, t, v = x.shape
        x = x.view(n, self.kernel_size, kc // self.kernel_size, t, v)
        x = torch.einsum("nkctv,kvw->nctw", x, adjacency)
        return x.contiguous(), adjacency


class STGCNBlock(nn.Module):
    def __init__(
        self,
        in_channels: int,
        out_channels: int,
        kernel_size: tuple[int, int],
        stride: int = 1,
        dropout: float = 0,
        residual: bool = True,
    ):
        super().__init__()
        padding = ((kernel_size[0] - 1) // 2, 0)
        self.gcn = ConvTemporalGraphical(in_channels, out_channels, kernel_size[1])
        self.tcn = nn.Sequential(
            nn.BatchNorm2d(out_channels),
            nn.ReLU(inplace=True),
            nn.Conv2d(
                out_channels, out_channels, (kernel_size[0], 1),
                (stride, 1), padding,
            ),
            nn.BatchNorm2d(out_channels),
            nn.Dropout(dropout, inplace=True),
        )
        if not residual:
            self.residual: nn.Module | None = None
        elif in_channels == out_channels and stride == 1:
            self.residual = nn.Identity()
        else:
            self.residual = nn.Sequential(
                nn.Conv2d(in_channels, out_channels, kernel_size=1, stride=(stride, 1)),
                nn.BatchNorm2d(out_channels),
            )
        self.relu = nn.ReLU(inplace=True)

    def forward(self, x: torch.Tensor, adjacency: torch.Tensor):
        residual = 0 if self.residual is None else self.residual(x)
        x, adjacency = self.gcn(x, adjacency)
        x = self.tcn(x) + residual
        return self.relu(x), adjacency


class STGCN(nn.Module):
    def __init__(self, in_channels: int = 2, features: int = 256):
        super().__init__()
        adjacency = torch.tensor(spatial_graph(), dtype=torch.float32)
        self.register_buffer("A", adjacency)
        spatial_kernel = adjacency.shape[0]
        kernel_size = (9, spatial_kernel)
        self.data_bn = nn.BatchNorm1d(in_channels * adjacency.shape[1])
        channels = [
            (in_channels, 64, 1, False),
            (64, 64, 1, True),
            (64, 64, 1, True),
            (64, 64, 1, True),
            (64, 128, 2, True),
            (128, 128, 1, True),
            (128, 128, 1, True),
            (128, 256, 2, True),
            (256, 256, 1, True),
            (256, features, 1, True),
        ]
        self.st_gcn_networks = nn.ModuleList([
            STGCNBlock(inp, out, kernel_size, stride=stride, residual=residual)
            for inp, out, stride, residual in channels
        ])
        self.edge_importance = nn.ParameterList([
            nn.Parameter(torch.ones_like(self.A, dtype=torch.get_default_dtype()))
            for _ in self.st_gcn_networks
        ])

    def forward(self, x: torch.Tensor):
        n, c, t, v = x.shape
        x = x.permute(0, 3, 1, 2).contiguous().view(n, v * c, t)
        x = self.data_bn(x)
        x = x.view(n, v, c, t).permute(0, 2, 3, 1).contiguous()
        for block, importance in zip(self.st_gcn_networks, self.edge_importance):
            x, _ = block(x, self.A * importance)
        x = F.avg_pool2d(x, x.shape[2:])
        return x.view(n, -1)


class Classifier(nn.Module):
    def __init__(self, features: int, classes: int):
        super().__init__()
        self.dropout = nn.Dropout(p=0.05)
        self.classifier = nn.Linear(features, classes)

    def forward(self, x: torch.Tensor):
        return self.classifier(self.dropout(x))


class Network(nn.Module):
    def __init__(self, classes: int):
        super().__init__()
        self.encoder = STGCN()
        self.decoder = Classifier(256, classes)

    def forward(self, x: torch.Tensor):
        return self.decoder(self.encoder(x))


def load_labels(train_csv: Path) -> list[str]:
    with train_csv.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        if not reader.fieldnames or "Gloss" not in reader.fieldnames:
            raise ValueError("ASL Citizen train CSV must contain a Gloss column")
        labels = sorted({row["Gloss"].strip() for row in reader if row.get("Gloss", "").strip()})
    if len(labels) != 2731:
        raise ValueError(f"Expected 2,731 ASL Citizen glosses, found {len(labels)}")
    return labels


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("checkpoint", type=Path)
    parser.add_argument("train_csv", type=Path)
    parser.add_argument("--output", type=Path, default=Path("work/asl-citizen-stgcn"))
    parser.add_argument("--verification-samples", type=int, default=3)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)

    labels = load_labels(args.train_csv)
    torch.manual_seed(20261002)
    np.random.seed(20261002)

    original_default = torch.get_default_dtype()
    torch.set_default_dtype(torch.float64)
    try:
        model64 = Network(len(labels))
    finally:
        torch.set_default_dtype(original_default)

    state = torch.load(args.checkpoint, map_location="cpu", weights_only=True)
    if not isinstance(state, dict):
        raise TypeError("Checkpoint did not contain a state_dict")
    missing, unexpected = model64.load_state_dict(state, strict=False)
    if missing or unexpected:
        raise ValueError(f"Checkpoint contract mismatch: missing={missing}, unexpected={unexpected}")
    model64.eval()

    model32 = copy.deepcopy(model64).float().eval()
    agreements = 0
    max_abs_error = 0.0
    verification = []
    for index in range(args.verification_samples):
        sample32 = torch.randn(1, 2, 128, 27, dtype=torch.float32) * 0.35
        with torch.no_grad():
            logits64 = model64(sample32.double()).float()
            logits32 = model32(sample32)
        prediction64 = int(logits64.argmax(dim=1).item())
        prediction32 = int(logits32.argmax(dim=1).item())
        error = float(torch.max(torch.abs(logits64 - logits32)).item())
        agreements += int(prediction64 == prediction32)
        max_abs_error = max(max_abs_error, error)
        verification.append({
            "sample": index,
            "top1_float64": prediction64,
            "top1_float32": prediction32,
            "top1_agree": prediction64 == prediction32,
            "max_abs_logit_error": error,
        })

    model_path = args.output / "model.onnx"
    dummy = torch.zeros(1, 2, 128, 27, dtype=torch.float32)
    torch.onnx.export(
        model32,
        dummy,
        model_path,
        input_names=["landmarks"],
        output_names=["logits"],
        dynamic_axes={"landmarks": {0: "batch"}, "logits": {0: "batch"}},
        opset_version=18,
        do_constant_folding=True,
    )
    (args.output / "labels.json").write_text(json.dumps(labels, indent=2), encoding="utf-8")

    import onnxruntime as ort

    session = ort.InferenceSession(str(model_path), providers=["CPUExecutionProvider"])
    ort_agreements = 0
    ort_max_abs_error = 0.0
    ort_checks = []
    for index in range(args.verification_samples):
        sample = np.random.normal(0, 0.35, size=(1, 2, 128, 27)).astype(np.float32)
        with torch.no_grad():
            native = model32(torch.from_numpy(sample)).numpy()
        runtime = session.run(["logits"], {"landmarks": sample})[0]
        native_top1 = int(native.argmax(axis=1)[0])
        runtime_top1 = int(runtime.argmax(axis=1)[0])
        error = float(np.max(np.abs(native - runtime)))
        ort_agreements += int(native_top1 == runtime_top1)
        ort_max_abs_error = max(ort_max_abs_error, error)
        ort_checks.append({
            "sample": index,
            "native_top1": native_top1,
            "onnx_top1": runtime_top1,
            "top1_agree": native_top1 == runtime_top1,
            "max_abs_logit_error": error,
        })

    report = {
        "source": "Microsoft ASL Citizen official ST-GCN checkpoint",
        "checkpoint_sha256": sha256(args.checkpoint),
        "train_csv_sha256": sha256(args.train_csv),
        "labels": len(labels),
        "labels_sha256": hashlib.sha256("\n".join(labels).encode()).hexdigest(),
        "onnx_bytes": model_path.stat().st_size,
        "onnx_sha256": sha256(model_path),
        "float64_to_float32": {
            "samples": args.verification_samples,
            "top1_agreement": agreements / max(1, args.verification_samples),
            "max_abs_logit_error": max_abs_error,
            "records": verification,
        },
        "pytorch_to_onnxruntime": {
            "samples": args.verification_samples,
            "top1_agreement": ort_agreements / max(1, args.verification_samples),
            "max_abs_logit_error": ort_max_abs_error,
            "records": ort_checks,
        },
        "input": {
            "shape": ["batch", 2, 128, 27],
            "dtype": "float32",
            "note": "Exact upstream 27-node MediaPipe ST-GCN contract; preprocessing must match ASL Citizen baseline.",
        },
        "distribution": "research-only; do not redistribute Microsoft checkpoint/data-derived artifacts without permission",
    }
    (args.output / "export-report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
