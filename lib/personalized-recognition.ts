import type { CalibrationTemplate, Point, VisionFrame } from "./vision-types";

export const CALIBRATION_SEQUENCE_LENGTH = 24;

export function templatesForLanguage(
  templates: CalibrationTemplate[],
  language: NonNullable<CalibrationTemplate["language"]>,
) {
  // Version-one templates had no language field and could only have been
  // recorded in ASL. Preserve them there, but never leak them into a new
  // BSL, CSL or ISL vocabulary.
  return templates.filter((template) => (template.language ?? "asl") === language);
}

const ZERO_HAND = new Array(66).fill(0);
const ZERO_FACE = new Array(41).fill(0);
const ZERO_POSE = new Array(35).fill(0);

export function prepareCalibrationSequence(frames: VisionFrame[]) {
  if (!frames.length) return [];
  const features = frames.map(frameToFeatures);
  return resample(features, CALIBRATION_SEQUENCE_LENGTH);
}

export function recognizePersonalTemplate(
  frames: VisionFrame[],
  templates: CalibrationTemplate[],
) {
  if (!templates.length || frames.length < 18) return null;
  const recent = frames.slice(-CALIBRATION_SEQUENCE_LENGTH);
  if (recent.filter((frame) => frame.hands.length > 0).length < 15) return null;

  const candidate = prepareCalibrationSequence(recent);
  let best: { template: CalibrationTemplate; distance: number } | null = null;

  for (const template of templates) {
    if (template.frames.length !== CALIBRATION_SEQUENCE_LENGTH) continue;
    const distance = sequenceDistance(candidate, template.frames);
    if (!best || distance < best.distance) best = { template, distance };
  }

  if (!best || best.distance > 0.62) return null;
  const confidence = clamp(0.965 - best.distance * 0.24, 0, 0.96);
  return {
    label: best.template.gloss,
    text: best.template.text,
    confidence,
  };
}

export function sequenceDistance(a: number[][], b: number[][]) {
  if (!a.length || !b.length) return Number.POSITIVE_INFINITY;
  const rows = a.length + 1;
  const cols = b.length + 1;
  const matrix = Array.from({ length: rows }, () => new Float64Array(cols).fill(Number.POSITIVE_INFINITY));
  matrix[0][0] = 0;

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = featureDistance(a[i - 1], b[j - 1]);
      matrix[i][j] = cost + Math.min(matrix[i - 1][j], matrix[i][j - 1], matrix[i - 1][j - 1]);
    }
  }

  return matrix[a.length][b.length] / Math.max(a.length, b.length);
}

function frameToFeatures(frame: VisionFrame) {
  const shoulders = frame.pose.length > 12 ? [frame.pose[11], frame.pose[12]] : [];
  const wrists = frame.hands.map((hand) => hand.landmarks[0]).filter(Boolean);
  const anchor = shoulders.length === 2
    ? midpoint(shoulders[0], shoulders[1])
    : averagePoint(wrists);
  const bodyScale = shoulders.length === 2
    ? Math.max(distance(shoulders[0], shoulders[1]), 0.08)
    : Math.max(pointRange(wrists), 0.18);

  const left = frame.hands.find((hand) => hand.handedness === "Left") ?? frame.hands[1];
  const right = frame.hands.find((hand) => hand.handedness === "Right") ?? frame.hands[0];

  return [
    ...handFeatures(left, anchor, bodyScale),
    ...handFeatures(right === left ? undefined : right, anchor, bodyScale),
    ...landmarkFeatures(frame.face, anchor, bodyScale, ZERO_FACE),
    ...landmarkFeatures(frame.pose, anchor, bodyScale, ZERO_POSE),
  ];
}

function handFeatures(
  hand: VisionFrame["hands"][number] | undefined,
  anchor: Point,
  bodyScale: number,
) {
  if (!hand?.landmarks.length) return ZERO_HAND;
  const wrist = hand.landmarks[0];
  const palm = hand.landmarks[9] ?? hand.landmarks[5] ?? wrist;
  const handScale = Math.max(distance(wrist, palm), 0.025);
  const local = hand.landmarks.slice(0, 21).flatMap((point) => [
    clamp((point.x - wrist.x) / handScale, -5, 5),
    clamp((point.y - wrist.y) / handScale, -5, 5),
    clamp((point.z - wrist.z) / handScale, -5, 5),
  ]);
  while (local.length < 63) local.push(0);
  return [
    1,
    clamp((wrist.x - anchor.x) / bodyScale, -4, 4),
    clamp((wrist.y - anchor.y) / bodyScale, -4, 4),
    ...local,
  ];
}

function landmarkFeatures(points: Point[], anchor: Point, scale: number, empty: number[]) {
  if (!points.length) return empty;
  const values = points.flatMap((point) => [
    clamp((point.x - anchor.x) / scale, -4, 4),
    clamp((point.y - anchor.y) / scale, -4, 4),
  ]);
  return [1, ...values];
}

function featureDistance(a: number[], b: number[]) {
  const length = Math.min(a.length, b.length);
  if (!length) return Number.POSITIVE_INFINITY;
  let total = 0;
  for (let index = 0; index < length; index += 1) {
    const delta = a[index] - b[index];
    total += Math.min(delta * delta, 4);
  }
  return Math.sqrt(total / length);
}

function resample(sequence: number[][], targetLength: number) {
  if (sequence.length === targetLength) return sequence;
  if (sequence.length === 1) return Array.from({ length: targetLength }, () => [...sequence[0]]);
  return Array.from({ length: targetLength }, (_, index) => {
    const sourceIndex = Math.round(index * (sequence.length - 1) / (targetLength - 1));
    return [...sequence[sourceIndex]];
  });
}

function averagePoint(points: Point[]) {
  if (!points.length) return { x: 0.5, y: 0.5, z: 0 };
  return points.reduce((total, point) => ({
    x: total.x + point.x / points.length,
    y: total.y + point.y / points.length,
    z: total.z + point.z / points.length,
  }), { x: 0, y: 0, z: 0 });
}

function midpoint(a: Point, b: Point) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
}

function pointRange(points: Point[]) {
  if (points.length < 2) return 0;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
}

function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
