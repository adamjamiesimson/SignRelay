export const BDSL_SIZE = 224;
export const BDSL_FRAMES = 16;
export const BDSL_CLASSES = 401;
export type BdslFrame = { width: number; height: number; rgba: Uint8ClampedArray };
export type BdslPrediction = { code: string; label: string; confidence: number };
export type BdslInput = { type: "load" } | { type: "recognize"; frames: BdslFrame[] };
export type BdslOutput = { type: "ready" } | { type: "result"; prediction: BdslPrediction | null }
  | { type: "error"; message: string };

function validateFrame(frame: BdslFrame) {
  if (!Number.isInteger(frame.width) || !Number.isInteger(frame.height)
    || frame.width < 1 || frame.height < 1 || frame.width > 1920 || frame.height > 1080
    || !(frame.rgba instanceof Uint8ClampedArray) || frame.rgba.length !== frame.width * frame.height * 4) {
    throw new Error("Expected a complete RGB camera frame, at most 1920 × 1080");
  }
}

/** Tensor Resize bilinear/antialias: centre-aligned triangle kernel, renormalized at edges. */
function resizeWeights(source: number, target: number) {
  const scale = Math.fround(source / target), support = Math.max(1, scale);
  const inverse = Math.fround(1 / support);
  return Array.from({ length: target }, (_, index) => {
    const centre = Math.fround((index + 0.5) * scale);
    const start = Math.max(0, Math.trunc(Math.fround(Math.fround(centre - support) + 0.5)));
    const end = Math.min(source, Math.trunc(Math.fround(Math.fround(centre + support) + 0.5)));
    const weights = Array.from({ length: end - start }, (_, i) => Math.fround(Math.max(0, 1 - Math.abs(Math.fround(Math.fround(Math.fround(start + i - centre) + 0.5) * inverse)))));
    const total = weights.reduce((sum, weight) => Math.fround(sum + weight), 0);
    return { start, weights: weights.map(weight => Math.fround(weight / total)) };
  });
}

/** Full-frame RGB resize; no letterbox or crop. Normalize before resizing like the author. */
export function resizeBdslFrame(frame: BdslFrame) {
  validateFrame(frame);
  const xWeights = resizeWeights(frame.width, BDSL_SIZE), yWeights = resizeWeights(frame.height, BDSL_SIZE);
  const output = new Float32Array(3 * BDSL_SIZE * BDSL_SIZE);
  const temporary = new Float32Array(frame.height * BDSL_SIZE);
  const means = [0.485, 0.456, 0.406], deviations = [0.229, 0.224, 0.225];
  for (let channel = 0; channel < 3; channel++) {
    for (let y = 0; y < frame.height; y++) for (let x = 0; x < BDSL_SIZE; x++) {
      const { start, weights } = xWeights[x];
      let sum = 0;
      for (let i = 0; i < weights.length; i++) {
        const value = Math.fround(Math.fround(Math.fround(frame.rgba[(y * frame.width + start + i) * 4 + channel] / 255) - Math.fround(means[channel])) / Math.fround(deviations[channel]));
        sum = Math.fround(sum + Math.fround(value * weights[i]));
      }
      temporary[y * BDSL_SIZE + x] = sum;
    }
    for (let y = 0; y < BDSL_SIZE; y++) for (let x = 0; x < BDSL_SIZE; x++) {
      const { start, weights } = yWeights[y];
      let sum = 0;
      for (let i = 0; i < weights.length; i++) sum = Math.fround(sum + Math.fround(temporary[(start + i) * BDSL_SIZE + x] * weights[i]));
      output[(channel * BDSL_SIZE + y) * BDSL_SIZE + x] = sum;
    }
  }
  return output;
}

/** Author's uniform temporal subsampling truncates each index (it does not round). */
export function bdslTemporalIndices(count: number) {
  if (!Number.isInteger(count) || count < 1 || count > 180) throw new Error("Expected 1–180 sampled frames");
  return Array.from({ length: BDSL_FRAMES }, (_, index) => Math.floor(index * (count - 1) / (BDSL_FRAMES - 1)));
}

export function packBdslFrames(frames: BdslFrame[]) {
  const indices = bdslTemporalIndices(frames.length);
  frames.forEach(validateFrame);
  if (frames.some(frame => frame.width !== frames[0].width || frame.height !== frames[0].height)) throw new Error("Frame dimensions changed during capture");
  const stride = 3 * BDSL_SIZE * BDSL_SIZE, values = new Float32Array(BDSL_FRAMES * stride);
  const cache = new Map<number, Float32Array>();
  for (const [position, index] of indices.entries()) {
    if (!cache.has(index)) cache.set(index, resizeBdslFrame(frames[index]));
    values.set(cache.get(index)!, position * stride);
  }
  return values;
}

/** Reject a static scene. This is not a trained no-sign detector. */
export function bdslClipHasMotion(frames: BdslFrame[]) {
  if (frames.length < 2) return false;
  frames.forEach(validateFrame);
  let change = 0, count = 0;
  for (let t = 1; t < frames.length; t++) {
    if (frames[t].width !== frames[0].width || frames[t].height !== frames[0].height) return false;
    for (let pixel = 0; pixel < frames[t].rgba.length; pixel += 64) {
      change += Math.abs(frames[t].rgba[pixel] - frames[t - 1].rgba[pixel]); count++;
    }
  }
  return count > 0 && change / count >= 1.5;
}

export function decodeBdslOutput(logits: Float32Array, labels: string[]): BdslPrediction | null {
  if (logits.length !== BDSL_CLASSES || labels.length !== BDSL_CLASSES
    || labels.some(label => typeof label !== "string" || !label.trim()) || !logits.every(Number.isFinite)) throw new Error("Bangla output/label mismatch");
  // The original label map intentionally contains three repeated English glosses.
  let best = 0;
  for (let index = 1; index < logits.length; index++) if (logits[index] > logits[best]) best = index;
  let total = 0, runnerUp = 0;
  for (let index = 0; index < logits.length; index++) {
    const value = Math.exp(logits[index] - logits[best]);
    total += value; if (index !== best) runnerUp = Math.max(runnerUp, value);
  }
  const confidence = 1 / total;
  // Conservative research defaults; not calibrated claims of real-world accuracy.
  if (confidence < 0.85 || confidence - runnerUp / total < 0.25) return null;
  return { code: `W${String(best + 1).padStart(3, "0")}`, label: labels[best], confidence };
}
