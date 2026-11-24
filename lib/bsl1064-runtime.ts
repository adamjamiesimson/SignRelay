import * as ort from "onnxruntime-web";
import { createLandmarkModelLoader, type InferenceOptions } from "./landmark-model-loader";
import { withLandmarkInference } from "./landmark-inference";
import type { Point, VisionFrame } from "./vision-types";
import { BSL_FRAMES, BSL_LANDMARKS, buildBslWindows, type BslInputOptions } from "./bsl-pose2sign-input";
import { describeBslDecision, type BslDecision, type BslPolicy } from "./bsl-diagnostics";

export type Bsl1064Prediction = { label: string; text: string; confidence: number; margin: number };
export type BslEngine = "legacy" | "v2";
export type BslAnalysis = { prediction: Bsl1064Prediction | null; decision: BslDecision };

const FRAMES = BSL_FRAMES;
const LANDMARKS = BSL_LANDMARKS;
const MIN_CONFIDENCE = 0.82;
const MIN_MARGIN = 0.14;
export const BSL_POLICY: BslPolicy = { minTop1: MIN_CONFIDENCE, minMargin: MIN_MARGIN, minHandFrames: 8 };

const loadModel = createLandmarkModelLoader("/models/bsl1064-pose2sign", 1064);

export type BslRecognitionOptions = InferenceOptions & {
  engine?: BslEngine;
  input?: BslInputOptions;
  policy?: BslPolicy;
  onDecision?: (decision: BslDecision) => void;
};

/** Start the (46 MB) model download/compile before the first sign completes. */
export async function warmBsl1064(signal?: AbortSignal) {
  await loadModel(signal);
}

/** Run the official BSL-1K body-and-hands Pose2Sign model in the worker. */
export async function recognizeBsl1064(sequence: VisionFrame[], options: BslRecognitionOptions = {}): Promise<Bsl1064Prediction | null> {
  return (await analyzeBsl1064(sequence, options))?.prediction ?? null;
}

/**
 * "legacy": the last 16 observed frames, unresampled, Tasks hand labels (the
 * original SignRelay adapter). "v2": the BSL-1K evaluation contract — 25 fps,
 * 16-frame windows with stride 8 over the sign movement, averaged logits,
 * anatomical (body-wrist) hand slots and OpenPose-style missing joints.
 */
export async function analyzeBsl1064(sequence: VisionFrame[], options: BslRecognitionOptions = {}): Promise<BslAnalysis | null> {
  const engine = options.engine ?? "legacy";
  if (sequence.length < FRAMES) return null;
  const policy = options.policy ?? BSL_POLICY;
  const prepared = engine === "v2" ? buildBslWindows(sequence, options.input) : null;
  const windows = prepared ? prepared.windows : [prepareBslInput(sequence)];
  const handFrames = prepared
    ? prepared.starts.reduce((total, start) => total + countHandFrames(prepared.timeline.frames.slice(start, start + FRAMES)), 0) / Math.max(1, prepared.starts.length)
    : sequence.slice(-FRAMES).filter(frame => frame.hands.some(hand => hand.landmarks.length >= 21)).length;
  const base = { spanFrames: prepared?.span ? prepared.span.end - prepared.span.start + 1 : FRAMES,
    handFrames: Math.round(handFrames), slotDisagreements: prepared?.timeline.slotDisagreements ?? 0, windows: windows.length };
  if (!windows.length) {
    const decision = describeBslDecision({ ...base, best: "", top5: [], pTop1: 0, margin: 0, inferenceMs: 0 }, policy);
    options.onDecision?.(decision);
    return { prediction: null, decision };
  }
  options.onPhase?.("loading");
  const { session, labels } = await loadModel(options.signal);
  options.signal?.throwIfAborted();
  return withLandmarkInference(session, options, async () => {
    const started = performance.now();
    const sum = new Float64Array(labels.length);
    for (const values of windows) {
      const logits = await runWindow(session, values, options.signal);
      if (!logits || logits.length !== labels.length) return null;
      for (let index = 0; index < logits.length; index++) sum[index] += logits[index];
    }
    const probabilities = softmax(Array.from(sum, value => value / windows.length));
    const order = probabilities.map((p, index) => ({ p, index })).sort((a, b) => b.p - a.p);
    const [best, runnerUp] = order;
    const top5 = order.slice(0, 5).map(({ p, index }) => ({ label: labels[index], p }));
    const decision = describeBslDecision({ ...base, best: labels[best.index] ?? "", top5, pTop1: best.p,
      margin: best.p - (runnerUp?.p ?? 0), inferenceMs: performance.now() - started }, policy);
    options.onDecision?.(decision);
    const label = labels[best.index];
    const prediction = decision.status === "accepted" && label
      ? { label, text: readable(label), confidence: best.p, margin: decision.margin } : null;
    return { prediction, decision };
  });
}

async function runWindow(session: ort.InferenceSession, values: Float32Array, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const input = new ort.Tensor("float32", values, [1, 3, FRAMES, LANDMARKS]);
  let output: Record<string, ort.Tensor> = {};
  try {
    output = await session.run({ pose: input });
    const logits = output.logits?.data;
    if (!(logits instanceof Float32Array) || !logits.every(Number.isFinite)) return null;
    return Float32Array.from(logits);
  } finally {
    input.dispose();
    Object.values(output).forEach(tensor => tensor.dispose());
  }
}

function countHandFrames(frames: Float32Array[]) {
  return frames.filter(values => values[18 * 3 + 2] > 0 || values[39 * 3 + 2] > 0).length;
}

/**
 * Legacy adapter (kept for comparison): the last 16 observed frames with raw
 * Tasks hand labels and no resampling. Coordinates are MediaPipe-normalised,
 * matching the model's 480px division only when the camera frames the signer
 * like the BSL-1K crops.
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

function softmax(logits: ArrayLike<number>) {
  const values = Array.from(logits);
  const maximum = Math.max(...values);
  const exps = values.map(value => Math.exp(value - maximum));
  const total = exps.reduce((sum, value) => sum + value, 0);
  return exps.map(value => value / total);
}

function readable(label: string) {
  return label.toLowerCase().replace(/[_.-]+/g, " ").replace(/\b\w/g, character => character.toUpperCase());
}
