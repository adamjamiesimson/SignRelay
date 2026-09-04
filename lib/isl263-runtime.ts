import * as ort from "onnxruntime-web";
import type { Point, VisionFrame } from "./vision-types";

export type Isl263Prediction = { label: string; text: string; confidence: number; margin: number };

const FRAME_COUNT = 200;
const FEATURES_PER_FRAME = 134;
const MIN_VISIBLE_FRAMES = 16;
const MIN_CONFIDENCE = 0.78;
const MIN_MARGIN = 0.18;

let modelPromise: Promise<{ session: ort.InferenceSession; labels: string[] }> | null = null;

async function loadModel() {
  modelPromise ??= Promise.all([
    ort.InferenceSession.create("/models/isl263-include/model.onnx", {
      // WebGPU is preferred for the transformer; ORT falls back to WASM on
      // browsers that have not exposed WebGPU yet.
      executionProviders: ["webgpu", "wasm"],
    }),
    fetch("/models/isl263-include/labels.json").then(async (response) => {
      if (!response.ok) throw new Error("INCLUDE-263 labels could not load");
      return response.json() as Promise<string[]>;
    }),
  ]).then(([session, labels]) => {
    if (labels.length !== 263) throw new Error("INCLUDE-263 label contract is invalid");
    return { session, labels };
  });
  return modelPromise;
}

/** Run the official 263-class AI4Bharat INCLUDE landmark transformer. */
export async function recognizeIsl263(sequence: VisionFrame[]): Promise<Isl263Prediction | null> {
  const prepared = prepareIncludeInput(sequence);
  if (prepared.visibleFrames < MIN_VISIBLE_FRAMES) return null;
  const { session, labels } = await loadModel();
  const output = await session.run({
    landmarks: new ort.Tensor("float32", prepared.values, [1, FRAME_COUNT, FEATURES_PER_FRAME]),
  });
  const logits = output.logits?.data;
  if (!(logits instanceof Float32Array) || logits.length !== labels.length) return null;
  const probabilities = softmax(logits);
  const best = probabilities.reduce((winner, value, index) => value > probabilities[winner] ? index : winner, 0);
  const runnerUp = probabilities.reduce((winner, value, index) => index !== best && value > probabilities[winner] ? index : winner, best ? 0 : 1);
  const confidence = probabilities[best];
  const margin = confidence - probabilities[runnerUp];
  const label = labels[best];
  if (!label || confidence < MIN_CONFIDENCE || margin < MIN_MARGIN) return null;
  return { label, text: readable(label), confidence, margin };
}

/**
 * Exact INCLUDE layout: 25 MediaPipe pose points, then left and right hands,
 * each stored as x/y pixel coordinates and padded to 200 frames. The official
 * data loader interpolates absent landmarks before this same end-padding.
 */
export function prepareIncludeInput(sequence: VisionFrame[]) {
  const recent = sequence.slice(-FRAME_COUNT);
  const frames = recent.map(frameFeatures);
  const values = new Float32Array(FRAME_COUNT * FEATURES_PER_FRAME);
  for (let landmark = 0; landmark < FEATURES_PER_FRAME / 2; landmark += 1) {
    interpolateCoordinate(frames, landmark, "x");
    interpolateCoordinate(frames, landmark, "y");
  }
  frames.forEach((frame, index) => values.set(frame.flatMap(point => [point.x, point.y]), index * FEATURES_PER_FRAME));
  return { values, visibleFrames: frames.filter(frame => frame.some(point => point.x !== 0 || point.y !== 0)).length };
}

type Coordinates = { x: number; y: number };

function frameFeatures(frame: VisionFrame): Coordinates[] {
  // INCLUDE's release contract is 25 body points even though modern
  // MediaPipe exposes 33. Its released training tensors use this prefix.
  const pose = Array.from({ length: 25 }, (_, index) => toPixels(frame.pose[index]));
  const left = hand(frame, "Left");
  const right = hand(frame, "Right");
  return [...pose, ...left, ...right];
}

function hand(frame: VisionFrame, handedness: "Left" | "Right") {
  const landmarks = frame.hands.find(candidate => candidate.handedness === handedness)?.landmarks;
  return Array.from({ length: 21 }, (_, index) => toPixels(landmarks?.[index]));
}

function toPixels(point: Point | undefined): Coordinates {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return { x: 0, y: 0 };
  return { x: point.x * 1920, y: point.y * 1080 };
}

function interpolateCoordinate(frames: Coordinates[][], landmark: number, axis: "x" | "y") {
  const known = frames.map((frame, index) => ({ index, value: frame[landmark][axis] })).filter(({ value }) => value !== 0);
  if (!known.length) return;
  for (let index = 0; index < frames.length; index += 1) {
    if (frames[index][landmark][axis] !== 0) continue;
    const before = [...known].reverse().find(sample => sample.index < index) ?? known[0];
    const after = known.find(sample => sample.index > index) ?? known[known.length - 1];
    const progress = before.index === after.index ? 0 : (index - before.index) / (after.index - before.index);
    frames[index][landmark][axis] = before.value + (after.value - before.value) * progress;
  }
}

function softmax(logits: Float32Array) {
  const maximum = Math.max(...logits);
  const values = Array.from(logits, value => Math.exp(value - maximum));
  const total = values.reduce((sum, value) => sum + value, 0);
  return values.map(value => value / total);
}

function readable(label: string) {
  const words = label.toLowerCase().replace(/(good|how|small|store|street|train|second|you)(afternoon|evening|morning|night|areyou|little|orshop|orroad|station|ticket|number|plural)/g, "$1 $2");
  return words.replace(/\b\w/g, character => character.toUpperCase());
}
