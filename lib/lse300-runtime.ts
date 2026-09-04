import * as ort from "onnxruntime-web";
import type { Point, VisionFrame } from "./vision-types";

export type Lse300Prediction = { label: string; text: string; confidence: number; margin: number };

const FRAMES = 64;
const LANDMARKS = 61;
const FEATURES = LANDMARKS * 3;
const MIN_CONFIDENCE = 0.76;
const MIN_MARGIN = 0.16;
const POSE_INDICES = [0, 2, 5, 7, 8, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24];

let modelPromise: Promise<{ session: ort.InferenceSession; labels: string[] }> | null = null;

async function loadModel() {
  modelPromise ??= Promise.all([
    ort.InferenceSession.create("/models/lse300-swl/model.onnx", { executionProviders: ["webgpu", "wasm"] }),
    fetch("/models/lse300-swl/labels.json").then(async response => {
      if (!response.ok) throw new Error("SWL-LSE labels could not load");
      return response.json() as Promise<string[]>;
    }),
  ]).then(([session, labels]) => {
    if (labels.length !== 300) throw new Error("SWL-LSE 300-label contract is invalid");
    return { session, labels };
  });
  return modelPromise;
}

/** Run SignRelay's SWL-LSE model trained on the released real-signer landmarks. */
export async function recognizeLse300(sequence: VisionFrame[]): Promise<Lse300Prediction | null> {
  if (sequence.length < 18) return null;
  const { session, labels } = await loadModel();
  const output = await session.run({ landmarks: new ort.Tensor("float32", prepareLseInput(sequence), [1, FRAMES, FEATURES]) });
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
 * Mirrors the SWL-LSE release layout: 19 selected MediaPipe pose landmarks,
 * then left and right 21-point hands. Each frame is centred and scaled by the
 * shoulders, then nearest-neighbour resampled to the model's 64-frame input.
 */
export function prepareLseInput(sequence: VisionFrame[]) {
  const source = sequence.slice(-FRAMES).map(framePoints);
  const samples = resample(source, FRAMES);
  const values = new Float32Array(FRAMES * FEATURES);
  samples.forEach((points, frameIndex) => {
    const leftShoulder = points[5];
    const rightShoulder = points[6];
    const centre = (leftShoulder.valid && rightShoulder.valid)
      ? midpoint(leftShoulder, rightShoulder)
      : { x: 0.5, y: 0.5, z: 0, valid: false };
    const scale = leftShoulder.valid && rightShoulder.valid
      ? Math.max(Math.hypot(leftShoulder.x - rightShoulder.x, leftShoulder.y - rightShoulder.y), 0.08)
      : 0.25;
    points.forEach((point, landmarkIndex) => {
      const offset = frameIndex * FEATURES + landmarkIndex * 3;
      if (!point.valid) return;
      values[offset] = (point.x - centre.x) / scale;
      values[offset + 1] = (point.y - centre.y) / scale;
      values[offset + 2] = (point.z - centre.z) / scale;
    });
  });
  return values;
}

type ModelPoint = { x: number; y: number; z: number; valid: boolean };

function framePoints(frame: VisionFrame): ModelPoint[] {
  const pose = POSE_INDICES.map(index => point(frame.pose[index]));
  return [...pose, ...hand(frame, "Left"), ...hand(frame, "Right")];
}

function hand(frame: VisionFrame, handedness: "Left" | "Right") {
  const landmarks = frame.hands.find(candidate => candidate.handedness === handedness)?.landmarks;
  return Array.from({ length: 21 }, (_, index) => point(landmarks?.[index]));
}

function point(value: Point | undefined): ModelPoint {
  if (!value || !Number.isFinite(value.x) || !Number.isFinite(value.y) || !Number.isFinite(value.z)) return { x: 0, y: 0, z: 0, valid: false };
  return { x: value.x, y: value.y, z: value.z, valid: true };
}

function midpoint(a: ModelPoint, b: ModelPoint): ModelPoint {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2, valid: a.valid && b.valid };
}

function resample<T>(sequence: T[], length: number) {
  if (!sequence.length) return [] as T[];
  return Array.from({ length }, (_, index) => sequence[Math.round(index * (sequence.length - 1) / Math.max(1, length - 1))]);
}

function softmax(logits: Float32Array) {
  const maximum = Math.max(...logits);
  const values = Array.from(logits, value => Math.exp(value - maximum));
  const total = values.reduce((sum, value) => sum + value, 0);
  return values.map(value => value / total);
}

function readable(label: string) {
  return label.toLocaleLowerCase("es-ES").replace(/[_.-]+/g, " ").replace(/\b\p{L}/gu, character => character.toLocaleUpperCase("es-ES"));
}
