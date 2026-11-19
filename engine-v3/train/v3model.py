"""Engine V3 isolated-sign model: in-graph landmark featurizer + 1D-conv/Transformer encoder.

Everything that turns gathered landmarks into features lives in `Featurizer` so the
exported ONNX graph performs it identically in the browser. The only preprocessing
outside the graph is `prepare_clip` (sign-span trimming and uniform resampling),
mirrored line-for-line in engine-v3/web/preprocess.mjs.
"""
from __future__ import annotations

import math, os, sys
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "pipeline"))
from points import N_POINTS, SHOULDERS  # noqa: E402

TMAX = 48          # 3.2 s at the 15 Hz analysis rate
PAD = 2            # frames kept before the first / after the last hand observation
N_HAND_PTS = 42
N_BODY_PTS = 42 + 13  # hands + pose: points that get velocity features


# ---------------------------------------------------------------- preprocessing (numpy, mirrored in JS)
def sign_span(pts):
    """First/last frame index with any hand point, padded by PAD. None when no hand was seen."""
    hand = np.isfinite(pts[:, :N_HAND_PTS, 0]).any(1)
    if not hand.any(): return None
    idx = np.nonzero(hand)[0]
    return max(0, int(idx[0]) - PAD), min(len(pts) - 1, int(idx[-1]) + PAD)


def resample_index(n, m):
    """Uniform nearest-frame indices taking n frames to m (m < n)."""
    return np.floor(np.arange(m) * (n - 1) / max(m - 1, 1) + 0.5).astype(np.int64)


def prepare_clip(pts, tmax=TMAX):
    """pts [T, 86, 3] float with NaN for missing -> (x [tmax,86,3], valid [tmax,86], fmask [tmax]) or None."""
    span = sign_span(pts)
    if span is None: return None
    seg = pts[span[0]:span[1] + 1]
    if len(seg) > tmax: seg = seg[resample_index(len(seg), tmax)]
    x = np.zeros((tmax, N_POINTS, 3), np.float32)
    valid = np.zeros((tmax, N_POINTS), np.float32)
    fmask = np.zeros(tmax, np.float32)
    ok = np.isfinite(seg[..., 0]) & np.isfinite(seg[..., 1]) & np.isfinite(seg[..., 2])
    x[:len(seg)] = np.where(ok[..., None], np.nan_to_num(seg), 0)
    valid[:len(seg)] = ok
    fmask[:len(seg)] = 1
    return x, valid, fmask


# ---------------------------------------------------------------- in-graph featurizer
class Featurizer(nn.Module):
    """x [B,T,86,3], valid [B,T,86], fmask [B,T] -> features [B,T,412]."""
    out_dim = 86 * 2 + 42 * 3 + N_BODY_PTS * 2 + 4

    def forward(self, x, valid, fmask):
        xy = x[..., :2]
        v = valid.unsqueeze(-1)
        # body reference: shoulder midpoint and width averaged over frames with both shoulders
        ls, rs = xy[:, :, SHOULDERS[0]], xy[:, :, SHOULDERS[1]]
        both = (valid[:, :, SHOULDERS[0]] * valid[:, :, SHOULDERS[1]]).unsqueeze(-1)  # [B,T,1]
        nb = both.sum(1)                                                                 # [B,1]
        c_sh = ((ls + rs) * 0.5 * both).sum(1) / nb.clamp(min=1)
        w_sh = ((ls - rs).norm(dim=-1, keepdim=True) * both).sum(1) / nb.clamp(min=1)
        # fallback when shoulders were never seen: centroid of all valid points, nominal width 0.3
        nv = v.sum((1, 2))
        c_fb = (xy * v).sum((1, 2)) / nv.clamp(min=1)
        has = (nb > 0).float()
        c = has * c_sh + (1 - has) * c_fb
        s = has * w_sh.clamp(min=1e-3) + (1 - has) * 0.3
        g = (xy - c[:, None, None, :]) / s[:, None, None, :] * v                       # [B,T,86,2]
        # hand-local shape: relative to wrist, scaled by hand extent
        hl = []
        for h in range(2):
            hx = x[:, :, h * 21:(h + 1) * 21, :]
            hv = valid[:, :, h * 21:(h + 1) * 21].unsqueeze(-1)
            rel = hx - hx[:, :, :1, :]
            size = rel[..., :2].norm(dim=-1).amax(-1, keepdim=True).clamp(min=1e-3).unsqueeze(-1)
            hl.append(rel / size * hv)
        hl = torch.cat(hl, 2)                                                            # [B,T,42,3]
        # velocity of hand and pose points (both frames valid)
        gb = g[:, :, :N_BODY_PTS]
        vb = valid[:, :, :N_BODY_PTS]
        prev = torch.cat([gb[:, :1], gb[:, :-1]], 1)
        pv = torch.cat([vb[:, :1], vb[:, :-1]], 1)
        vel = (gb - prev) * (vb * pv).unsqueeze(-1)
        flags = torch.stack([valid[:, :, 0], valid[:, :, 21], valid[:, :, 42 + 7], valid[:, :, 55]], -1)
        B, T = x.shape[:2]
        f = torch.cat([g.reshape(B, T, -1), hl.reshape(B, T, -1), vel.reshape(B, T, -1), flags], -1)
        return f * fmask.unsqueeze(-1)


# ---------------------------------------------------------------- encoder
class ConvBlock(nn.Module):
    def __init__(self, d, k=17, expand=2, drop=0.2):
        super().__init__()
        self.ln = nn.LayerNorm(d)
        self.inp = nn.Linear(d, d * expand)
        self.dw = nn.Conv1d(d * expand, d * expand, k, padding=k // 2, groups=d * expand)
        self.bn = nn.BatchNorm1d(d * expand)
        self.out = nn.Linear(d * expand, d)
        self.drop = nn.Dropout(drop)

    def forward(self, x, m):
        y = F.silu(self.inp(self.ln(x))) * m.unsqueeze(-1)
        y = self.dw(y.transpose(1, 2))
        y = F.silu(self.bn(y)).transpose(1, 2)
        return x + self.drop(self.out(y)) * m.unsqueeze(-1)


class AttnBlock(nn.Module):
    def __init__(self, d, heads=4, drop=0.2):
        super().__init__()
        self.h = heads
        self.ln1, self.ln2 = nn.LayerNorm(d), nn.LayerNorm(d)
        self.qkv = nn.Linear(d, 3 * d)
        self.proj = nn.Linear(d, d)
        self.ff = nn.Sequential(nn.Linear(d, 2 * d), nn.SiLU(), nn.Dropout(drop), nn.Linear(2 * d, d))
        self.drop = nn.Dropout(drop)

    def forward(self, x, m):
        B, T, D = x.shape
        q, k, v = self.qkv(self.ln1(x)).reshape(B, T, 3, self.h, D // self.h).permute(2, 0, 3, 1, 4)
        a = (q @ k.transpose(-1, -2)) / math.sqrt(D // self.h)
        a = a + (1.0 - m)[:, None, None, :] * -1e4
        y = (a.softmax(-1) @ v).transpose(1, 2).reshape(B, T, D)
        x = x + self.drop(self.proj(y))
        x = x + self.drop(self.ff(self.ln2(x)))
        return x * m.unsqueeze(-1)


class SignModel(nn.Module):
    def __init__(self, n_out, d=192, depth=2, k=17, drop=0.2, head_drop=0.4, kind="convformer"):
        super().__init__()
        self.feat = Featurizer()
        self.kind = kind
        self.stem = nn.Sequential(nn.Linear(Featurizer.out_dim, d), nn.LayerNorm(d))
        if kind == "convformer":
            blocks = []
            for _ in range(depth):
                blocks += [ConvBlock(d, k, drop=drop), ConvBlock(d, k, drop=drop), ConvBlock(d, k, drop=drop), AttnBlock(d, drop=drop)]
            self.blocks = nn.ModuleList(blocks)
        elif kind == "gru":
            self.gru = nn.GRU(d, d, num_layers=2, batch_first=True, bidirectional=True, dropout=drop)
            self.gproj = nn.Linear(2 * d, d)
        self.norm = nn.LayerNorm(d)
        self.head_drop = nn.Dropout(head_drop)
        self.head = nn.Linear(d, n_out)

    def embed(self, x, valid, fmask):
        h = self.stem(self.feat(x, valid, fmask)) * fmask.unsqueeze(-1)
        if self.kind == "convformer":
            for b in self.blocks: h = b(h, fmask)
        else:
            h = self.gproj(self.gru(h)[0]) * fmask.unsqueeze(-1)
        e = (h * fmask.unsqueeze(-1)).sum(1) / fmask.sum(1, keepdim=True).clamp(min=1)
        return self.norm(e)

    def forward(self, x, valid, fmask):
        return self.head(self.head_drop(self.embed(x, valid, fmask)))


class ExportWrapper(nn.Module):
    """ONNX entry point: returns logits and the L2-normalised embedding."""
    def __init__(self, m):
        super().__init__(); self.m = m

    def forward(self, x, valid, fmask):
        e = self.m.embed(x, valid, fmask)
        return self.m.head(e), F.normalize(e, dim=-1)
