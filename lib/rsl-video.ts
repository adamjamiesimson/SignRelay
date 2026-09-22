import labels from "../public/models/rsl1000-slovo/labels.json";

export const RSL_FRAMES = 32;
export const RSL_SIZE = 224;
export const RSL_FRAME_BYTES = RSL_SIZE * RSL_SIZE * 4;
export const RSL_LABELS = labels.slice(0, 1000);
export type RslPrediction = { label: string; confidence: number };
export type RslInput = { type: "load" } | { type: "recognize"; frames: Uint8ClampedArray[] };
export type RslOutput = { type: "ready" } | { type: "result"; prediction: RslPrediction | null }
  | { type: "error"; message: string };

/** Official Slovo demo preprocessing: RGB, 114-valued letterbox, 224 square. */
export function rslLetterbox(width: number, height: number) {
  if (!(width > 0 && height > 0 && Number.isFinite(width + height))) throw new Error("Invalid video dimensions");
  const scale = RSL_SIZE / Math.max(width, height);
  const w = Math.round(width * scale), h = Math.round(height * scale);
  return { width: w, height: h, x: Math.max(0, Math.round((RSL_SIZE - w) / 2 - 0.1)), y: Math.max(0, Math.round((RSL_SIZE - h) / 2 - 0.1)) };
}

export function packRslFrames(frames: Uint8ClampedArray[]) {
  if (frames.length !== RSL_FRAMES || frames.some(frame => !(frame instanceof Uint8ClampedArray) || frame.length !== RSL_FRAME_BYTES)) {
    throw new Error("Slovo requires exactly 32 complete RGBA frames");
  }
  const pixels = RSL_SIZE * RSL_SIZE;
  const values = new Float32Array(3 * RSL_FRAMES * pixels);
  const mean = [123.675, 116.28, 103.53], std = [58.395, 57.12, 57.375];
  for (let c = 0; c < 3; c++) for (let t = 0; t < RSL_FRAMES; t++) {
    const offset = (c * RSL_FRAMES + t) * pixels;
    for (let p = 0; p < pixels; p++) values[offset + p] = (frames[t][p * 4 + c] - mean[c]) / std[c];
  }
  return values;
}

/** Coarse idle guard, not proof that a meaningful sign occurred. */
export function rslClipHasMotion(frames: Uint8ClampedArray[]) {
  if (frames.length !== RSL_FRAMES || frames.some(frame => frame.length !== RSL_FRAME_BYTES)) return false;
  let change = 0, samples = 0;
  for (let t = 4; t < frames.length; t += 4) for (let p = 0; p < RSL_FRAME_BYTES; p += 64) {
    change += Math.abs(frames[t][p] - frames[t - 4][p]); samples++;
  }
  return change / samples >= 1.5;
}

/** The ONNX output ALREADY contains probabilities. Do not softmax twice. */
export function decodeRslOutput(probabilities: Float32Array): RslPrediction | null {
  if (probabilities.length !== 1001) throw new Error("Slovo output/label mismatch");
  let best = 0, second = 0, total = 0;
  for (let i = 0; i < probabilities.length; i++) {
    const value = probabilities[i];
    if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error("Invalid Slovo probability");
    total += value;
    if (value > probabilities[best]) best = i;
  }
  if (Math.abs(total - 1) > 0.01) throw new Error("Invalid Slovo probability sum");
  for (let i = 0; i < probabilities.length; i++) if (i !== best) second = Math.max(second, probabilities[i]);
  if (best === 1000 || probabilities[best] < 0.85 || probabilities[best] - second < 0.25) return null;
  return { label: labels[best], confidence: probabilities[best] };
}
