import * as ort from "onnxruntime-web";
import type { Point, VisionFrame } from "./vision-types";

export type Bsl1064Prediction = { label: string; text: string; confidence: number; margin: number };

const FRAMES = 16;
const LANDMARKS = 60;
const MIN_CONFIDENCE = 0.82;
const MIN_MARGIN = 0.14;

let modelPromise: Promise<{ session: ort.InferenceSession; labels: string[] }> | null = null;

async function loadModel() {
  modelPromise ??= Promise.all([
    ort.InferenceSession.create("/models/bsl1064-pose2sign/model.onnx", { executionProviders: ["webgpu", "wasm"] }),
    fetch("/models/bsl1064-pose2sign/labels.json").then(async response => {
      if (!response.ok) throw new Error("BSL-1064 labels could not load");
      return response.json() as Promise<string[]>;
    }),
  ]).then(([session, labels]) => {
    if (labels.length !== 1064) throw new Error("BSL-1064 label contract is invalid");
    return { session, labels };
  });
  return modelPromise;
}

/** Run the official BSL-1K body-and-hands Pose2Sign model in the worker. */
export async function recognizeBsl1064(sequence: VisionFrame[]): Promise<Bsl1064Prediction | null> {
  if (sequence.length < FRAMES) return null;
  const { session, labels } = await loadModel();
  const output = await session.run({ pose: new ort.Tensor("float32", prepareBslInput(sequence), [1, 3, FRAMES, LANDMARKS]) });
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
 * BSL-1K trained Pose2Sign on OpenPose COCO-18 body points + 21-point left
 * and right hands. Coordinates are already normalised in SignRelay, matching
 * the model's source data after its 480px normalisation step.
 */
export function prepareBslInput(sequence: VisionFrame[]) {
  const samples = sequence.slice(-FRAMES);
  const values = new Float32Array(3 * FRAMES * LANDMARKS);
  samples.forEach((frame, frameIndex) => {
    const points = [...body18(frame), ...hand(frame, "Left"), ...hand(frame, "Right")];
    points.forEach((point, landmarkIndex) => {
      values[frameIndex * LANDMARKS + landmarkIndex] = point.x;
      values[FRAMES * LANDMARKS + frameIndex * LANDMARKS + landmarkIndex] = point.y;
      values[2 * FRAMES * LANDMARKS + frameIndex * LANDMARKS + landmarkIndex] = point.score;
    });
  });
  return values;
}

type PosePoint = { x: number; y: number; score: number };

function body18(frame: VisionFrame): PosePoint[] {
  const pose = (index: number) => point(frame.pose[index]);
  const neck = midpoint(pose(11), pose(12));
  // OpenPose COCO order: nose, neck, right side, left side, lower body,
  // eyes and ears. MediaPipe's named pose landmarks are mapped explicitly.
  return [pose(0), neck, pose(12), pose(14), pose(16), pose(11), pose(13), pose(15), pose(24), pose(26), pose(28), pose(23), pose(25), pose(27), pose(5), pose(2), pose(8), pose(7)];
}

function hand(frame: VisionFrame, handedness: "Left" | "Right") {
  const landmarks = frame.hands.find(candidate => candidate.handedness === handedness)?.landmarks;
  return Array.from({ length: 21 }, (_, index) => point(landmarks?.[index]));
}

function point(value: Point | undefined): PosePoint {
  if (!value || !Number.isFinite(value.x) || !Number.isFinite(value.y)) return { x: 0, y: 0, score: 0 };
  return { x: value.x, y: value.y, score: value.visibility ?? 1 };
}

function midpoint(a: PosePoint, b: PosePoint): PosePoint {
  if (!a.score || !b.score) return { x: 0, y: 0, score: 0 };
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, score: Math.min(a.score, b.score) };
}

function softmax(logits: Float32Array) {
  const maximum = Math.max(...logits);
  const values = Array.from(logits, value => Math.exp(value - maximum));
  const total = values.reduce((sum, value) => sum + value, 0);
  return values.map(value => value / total);
}

function readable(label: string) {
  return label.toLowerCase().replace(/[_.-]+/g, " ").replace(/\b\w/g, character => character.toUpperCase());
}
