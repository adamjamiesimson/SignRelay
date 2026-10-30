import type { VisionFrame } from "./vision-types";
import { fixedRateIndices } from "./tgcn-input";

/**
 * Features for the PopSign landmark candidate, mirroring clip_features() in
 * training/train_landmark_classifier.py exactly (tests/landmark-sign-features
 * compares against a Python-generated fixture). Frames are first placed on the
 * training data's 25 fps grid; the hand-present span is resampled to SEQUENCE.
 */
export const SEQUENCE = 32;
const POSE_POINTS = [0, 13, 14, 15, 16];
export const FEATURES = 2 * (42 + 42 + 1) + POSE_POINTS.length * 2;
const TRAINING_FPS = 25;

type Body = { cx: number; cy: number; scale: number };

function bodyFrame(frame: VisionFrame): Body | null {
  const left = frame.pose[11], right = frame.pose[12];
  if (!left || !right || [left.x, left.y, right.x, right.y].some(value => !Number.isFinite(value))
    || (left.visibility ?? 1) < 0.4 || (right.visibility ?? 1) < 0.4) return null;
  return { cx: (left.x + right.x) / 2, cy: (left.y + right.y) / 2, scale: Math.max(Math.hypot(left.x - right.x, left.y - right.y), 0.05) };
}

function slot(frame: VisionFrame, label: "Left" | "Right") {
  const hand = frame.hands.find(candidate => candidate.handedness === label);
  return hand && hand.landmarks.length === 21 && hand.landmarks.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)) ? hand.landmarks : null;
}

/** numpy.round: halves go to the even neighbour. */
function roundHalfEven(value: number) {
  const floor = Math.floor(value), fraction = value - floor;
  if (Math.abs(fraction - 0.5) > 1e-9) return Math.round(value);
  return floor % 2 === 0 ? floor : floor + 1;
}

export function landmarkSignFeatures(sequence: VisionFrame[]): Float32Array | null {
  const frames = fixedRateIndices(sequence.map(frame => frame.timestamp), TRAINING_FPS).map(index => sequence[index]);
  const present = frames.map(frame => !!(slot(frame, "Left") || slot(frame, "Right")));
  if (present.filter(Boolean).length < 4) return null;
  const first = present.indexOf(true), last = present.lastIndexOf(true);
  const bodies: (Body | null)[] = [];
  let reference: Body | null = null;
  for (const frame of frames) { reference = bodyFrame(frame) ?? reference; bodies.push(reference); }
  const fallback = bodies.find(Boolean) ?? null;
  if (!fallback) return null;
  const out = new Float32Array(SEQUENCE * FEATURES);
  for (let row = 0; row < SEQUENCE; row++) {
    const t = roundHalfEven(first + (last - first) * row / (SEQUENCE - 1));
    const { cx, cy, scale } = bodies[t] ?? fallback;
    const values: number[] = [];
    for (const label of ["Left", "Right"] as const) {
      const points = slot(frames[t], label);
      if (!points) { values.push(...new Array(85).fill(0)); continue; }
      const palm = Math.max(Math.hypot(points[9].x - points[0].x, points[9].y - points[0].y),
        Math.hypot(points[17].x - points[5].x, points[17].y - points[5].y), 1e-3);
      for (const p of points) values.push((p.x - cx) / scale, (p.y - cy) / scale);
      for (const p of points) values.push((p.x - points[0].x) / palm, (p.y - points[0].y) / palm);
      values.push(1);
    }
    for (const index of POSE_POINTS) {
      const point = frames[t].pose[index];
      const usable = point && Number.isFinite(point.x) && Number.isFinite(point.y) && (point.visibility ?? 1) >= 0.3;
      values.push(usable ? (point.x - cx) / scale : 0, usable ? (point.y - cy) / scale : 0);
    }
    for (let i = 0; i < FEATURES; i++) out[row * FEATURES + i] = Math.max(-8, Math.min(8, Number.isFinite(values[i]) ? values[i] : 0));
  }
  return out;
}
