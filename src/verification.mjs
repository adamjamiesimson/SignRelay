import { hasHand, resampleTo15Hz } from './upstream-preprocess.mjs';

const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, value));
export const PROFILE = Object.freeze({ minimumFrames: 6, maxGap: 300, sparseGap: 640, sparseFps: 8, sampleMs: 64, evaluateEvery: 205, historyMs: 1900 });
export const WINDOWS = [700, 1150, 1800];

function handExcursion(frames, offset, minimum) {
  const points = [0, 5, 8, 12, 20];
  const total = points.map(() => []);
  let scale = 0;
  let count = 0;
  for (const { f } of frames) {
    const i = offset * 3;
    if (!Number.isFinite(f[i])) continue;
    const palm = Math.hypot(f[i] - f[i + 27], f[i + 1] - f[i + 28]);
    if (palm < 0.018) continue;
    count++;
    scale += palm;
    points.forEach((point, j) => total[j].push([f[i + 3 * point], f[i + 3 * point + 1]]));
  }
  if (count < minimum) return 0;
  let travel = 0;
  for (const trajectory of total) {
    for (const [a, p] of trajectory.entries()) {
      for (let b = a + 2; b < trajectory.length; b++) {
        travel = Math.max(travel, Math.hypot(p[0] - trajectory[b][0], p[1] - trajectory[b][1]));
      }
    }
  }
  return travel / (scale / count);
}

export function windowFor(history, millis, sparse = false) {
  if (!history.length) return null;
  const end = history.at(-1).t;
  const samples = history.filter(item => item.t >= end - millis);
  const visible = samples.filter(item => hasHand(item.f));
  const minFrames = sparse ? 3 : PROFILE.minimumFrames;
  const maxGap = sparse ? PROFILE.sparseGap : PROFILE.maxGap;
  if (visible.length < minFrames || visible.at(-1).t - visible[0].t < (sparse ? 510 : 260) ||
      visible.some((item, i) => i && item.t - visible[i - 1].t > maxGap)) return null;
  const minimum = sparse ? 3 : 4;
  const motion = Math.max(handExcursion(visible, 0, minimum), handExcursion(visible, 21, minimum));
  if (motion < (sparse ? 0.29 : 0.22)) return null;
  return { frames: resampleTo15Hz(samples), motion, handFrames: visible.length };
}

export function targetEvidence(logits, embedding, metadata, indices) {
  const temperature = metadata.policy.temperature;
  const peak = Math.max(...logits);
  const exp = Float64Array.from(logits, logit => Math.exp((logit - peak) / temperature));
  const divisor = exp.reduce((sum, item) => sum + item);
  const unknown = exp[metadata.unknown_index] / divisor;
  return indices.map(index => {
    if (index < 0) return { p: 0, cosine: 0, unknown, score: 0 };
    const offset = index * embedding.length;
    let cosine = 0;
    for (let k = 0; k < embedding.length; k++) cosine += metadata.prototypes[offset + k] * embedding[k];
    const p = exp[index] / divisor;
    const likeness = clamp((cosine - 0.43) / 0.45);
    const score = p < 0.032 || unknown >= 0.75 ? 0 : clamp(0.66 * Math.sqrt(p) + 0.34 * likeness);
    return { p, cosine, unknown, score };
  });
}

export class Confirmation {
  constructor() { this.reset(); }
  reset() { this.previous = null; }
  push(score, timestamp, threshold) {
    if (score < threshold) {
      this.reset();
      return false;
    }
    const elapsed = this.previous === null ? Infinity : timestamp - this.previous;
    this.previous = timestamp;
    return elapsed >= 125 && elapsed <= 850;
  }
}

