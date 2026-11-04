// A deliberately simple, transparent baseline for a temporal isolated-sign
// recognizer with unknown-sign rejection (docs/research/temporal-recognizer/).
// It is a yardstick for the experiment framework, not a product model:
// segmentation -> fixed-length body-relative feature sequence -> banded DTW
// k-nearest-neighbour against labelled prototypes, with explicit "other"
// prototypes (non-target signing and everyday movement) and two rejection
// tests (absolute distance, and closeness to "other"), calibrated on training
// signers only. Not used by the app.
import { CHANNEL_GROUPS, CHANNEL_INDEX, extractFeatures, repetitionOf, resample, segmentActive, type ChannelGroup } from "./sign-features";
import type { VisionFrame } from "./vision-types";

export const OTHER = "__other__";
export type BaselineConfig = {
  length: number;
  /** Sakoe-Chiba band as a fraction of the length. */
  band: number;
  k: number;
  weights: Record<ChannelGroup, number> & { global: number };
  /** Rejection is calibrated so that, within training signers, at most this
   * fraction of "other" examples is accepted as a target sign. */
  targetFalseAccept: number;
};
/** Fixed before any data was seen; changing it is a new, separately reported experiment. */
export const BASELINE_CONFIG: Readonly<BaselineConfig> = Object.freeze({
  length: 24, band: 0.2, k: 1, weights: { handshape: 1, location: 1, motion: 0.5, twoHand: 0.5, global: 0.5 }, targetFalseAccept: 0.05,
});

export type Encoded = { rows: number[][]; global: number[]; ok: boolean; reason?: "no-hand" | "no-motion" };

export function encode(frames: VisionFrame[], config: BaselineConfig = BASELINE_CONFIG): Encoded {
  const seq = extractFeatures(frames);
  if (seq.rows.length < 3) return { rows: [], global: [], ok: false, reason: "no-hand" };
  const span = segmentActive(seq);
  if (!span) return { rows: [], global: [], ok: false, reason: "no-motion" };
  const active = seq.rows.slice(span[0], span[1]);
  const { reversals, autocorrelation } = repetitionOf(active);
  const duration = (seq.times[span[1] - 1] - seq.times[span[0]]) / 1000;
  return { rows: resample(active, config.length), global: [Math.min(reversals, 8) / 4, autocorrelation, Math.min(duration, 4)], ok: true };
}

type Stats = { mean: number[]; std: number[]; gMean: number[]; gStd: number[] };
function fitStats(items: Encoded[]): Stats {
  const rows = items.flatMap(item => item.rows), globals = items.map(item => item.global);
  const moments = (data: number[][], width: number) => {
    const mean = Array.from({ length: width }, (_, c) => data.reduce((s, r) => s + r[c], 0) / Math.max(1, data.length));
    const std = mean.map((m, c) => Math.sqrt(data.reduce((s, r) => s + (r[c] - m) ** 2, 0) / Math.max(1, data.length)) || 1);
    return { mean, std };
  };
  const a = moments(rows, rows[0]?.length ?? 0), b = moments(globals, globals[0]?.length ?? 0);
  return { mean: a.mean, std: a.std, gMean: b.mean, gStd: b.std };
}

const GROUP_OF: number[] = (() => {
  const out: number[] = [];
  const names = Object.keys(CHANNEL_GROUPS) as ChannelGroup[];
  names.forEach((group, g) => { for (const channel of CHANNEL_GROUPS[group]) out[CHANNEL_INDEX[channel]] = g; });
  return out;
})();

function weightedRows(item: Encoded, stats: Stats, config: BaselineConfig) {
  const groups = Object.keys(CHANNEL_GROUPS) as ChannelGroup[];
  const w = GROUP_OF.map(g => Math.sqrt(config.weights[groups[g]] / CHANNEL_GROUPS[groups[g]].length));
  return { rows: item.rows.map(r => r.map((v, c) => ((v - stats.mean[c]) / stats.std[c]) * w[c])),
    global: item.global.map((v, c) => ((v - stats.gMean[c]) / stats.gStd[c]) * Math.sqrt(config.weights.global / item.global.length)) };
}

/** Banded DTW, mean per-step Euclidean cost. */
export function dtw(a: number[][], b: number[][], band: number) {
  const n = a.length, m = b.length, r = Math.max(1, Math.ceil(band * Math.max(n, m)));
  let prev = new Float64Array(m + 1).fill(Infinity), cur = new Float64Array(m + 1);
  prev[0] = 0;
  for (let i = 1; i <= n; i++) {
    cur.fill(Infinity);
    for (let j = Math.max(1, i - r); j <= Math.min(m, i + r); j++) {
      let cost = 0;
      for (let c = 0; c < a[i - 1].length; c++) { const d = a[i - 1][c] - b[j - 1][c]; cost += d * d; }
      cur[j] = Math.sqrt(cost) + Math.min(prev[j], cur[j - 1], prev[j - 1]);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[m] / (n + m);
}

type Prototype = { label: string; signer: string; rows: number[][]; global: number[] };
export type BaselineModel = { config: BaselineConfig; stats: Stats; prototypes: Prototype[]; tau: number; rho: number; labels: string[] };
export type Training = { frames: VisionFrame[]; label: string; signer: string };
export type BaselinePrediction = { label: string | null; score: number; reason: "accepted" | "far" | "closer-to-other" | "unusable"; nearest: string | null };

function scores(model: Pick<BaselineModel, "config" | "stats" | "prototypes">, query: Encoded, exclude?: string) {
  const q = weightedRows(query, model.stats, model.config);
  const byLabel = new Map<string, number[]>();
  for (const p of model.prototypes) {
    if (exclude !== undefined && p.signer === exclude) continue;
    const d = dtw(q.rows, p.rows, model.config.band) + Math.hypot(...q.global.map((v, i) => v - p.global[i]));
    (byLabel.get(p.label) ?? byLabel.set(p.label, []).get(p.label)!).push(d);
  }
  const k = model.config.k;
  const distance = new Map([...byLabel].map(([label, ds]) => [label, ds.sort((a, b) => a - b).slice(0, k).reduce((s, v) => s + v, 0) / Math.min(k, ds.length)]));
  const targets = [...distance].filter(([label]) => label !== OTHER).sort((a, b) => a[1] - b[1]);
  return { best: targets[0] ?? null, second: targets[1] ?? null, other: distance.get(OTHER) ?? null };
}

function decide(s: ReturnType<typeof scores>, tau: number, rho: number): BaselinePrediction {
  if (!s.best) return { label: null, score: 0, reason: "unusable", nearest: null };
  const [label, d] = s.best;
  const contrast = s.other ?? s.second?.[1] ?? d * 2;
  const score = contrast / Math.max(d, 1e-9);
  if (d > tau) return { label: null, score, reason: "far", nearest: label };
  if (s.other !== null && d / s.other > rho) return { label: null, score, reason: "closer-to-other", nearest: label };
  return { label, score, reason: "accepted", nearest: label };
}

/** Train on labelled sequences (negatives labelled OTHER). Rejection thresholds
 * come from leave-one-signer-out over the TRAINING signers only. */
export function trainBaseline(data: Training[], config: BaselineConfig = BASELINE_CONFIG): BaselineModel {
  const encoded = data.map(item => ({ ...item, enc: encode(item.frames, config) })).filter(item => item.enc.ok);
  const stats = fitStats(encoded.map(item => item.enc));
  const prototypes = encoded.map(item => ({ label: item.label, signer: item.signer, ...weightedRows(item.enc, stats, config) }));
  const base = { config, stats, prototypes };
  // Inner leave-one-signer-out: what would each training example get from the others?
  const inner = encoded.map(item => ({ truth: item.label, s: scores(base, item.enc, item.signer) })).filter(x => x.s.best);
  const correct = inner.filter(x => x.truth !== OTHER && x.s.best![0] === x.truth).map(x => x.s.best![1]).sort((a, b) => a - b);
  const tau = correct.length ? correct[Math.min(correct.length - 1, Math.floor(0.95 * correct.length))] * 1.1 : Infinity;
  const negatives = inner.filter(x => x.truth === OTHER);
  let rho = 1;
  if (negatives.length) {
    // Largest ratio (most permissive) whose inner false-accept rate on "other" stays within target.
    const grid = Array.from({ length: 41 }, (_, i) => 0.5 + i * 0.0175);
    const allowed = grid.filter(r => negatives.filter(x => decide(x.s, tau, r).label !== null).length / negatives.length <= config.targetFalseAccept);
    rho = allowed.length ? Math.max(...allowed) : grid[0];
  }
  return { ...base, tau, rho, labels: [...new Set(encoded.map(item => item.label))].sort() };
}

export function predictBaseline(model: BaselineModel, frames: VisionFrame[]): BaselinePrediction {
  const enc = encode(frames, model.config);
  if (!enc.ok) return { label: null, score: 0, reason: "unusable", nearest: null };
  return decide(scores(model, enc), model.tau, model.rho);
}
