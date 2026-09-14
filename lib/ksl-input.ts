import type { Point } from "./vision-types";

/** Pinned Seoyoung07 Holistic layout; retain full, index-preserving face mesh. */
export const KSL_FACE_INDICES = [
  61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 185, 40, 39, 37,
  0, 267, 269, 270, 409, 78, 95, 88, 178, 87, 14, 317, 402, 318, 324,
  308, 191, 80, 81, 82, 13, 312, 311, 310, 415, 33, 133, 159, 145,
  263, 362, 386, 374, 70, 63, 105, 66, 336, 296, 334, 293, 1, 2, 98, 327,
] as const;
export const KSL_FRAMES = 64;
export const KSL_KEYPOINTS = 115;
const FRAME_VALUES = KSL_KEYPOINTS * 4;

// VisionFrame's compressed face and cached pose are not synchronized Holistic.
export type KslHolisticFrame = {
  pose: readonly Point[];
  leftHand: readonly Point[];
  rightHand: readonly Point[];
  faceMesh: readonly Point[];
};

function pointValues(point: Point, useVisibility = false): number[] {
  const confidence = useVisibility ? point.visibility ?? 1 : 1;
  if (![point.x, point.y, point.z, confidence].every(Number.isFinite)) {
    throw new Error("KSL landmarks must be finite");
  }
  return [point.x, point.y, point.z, confidence];
}

function checkCount(points: readonly Point[], count: number, name: string) {
  if (points.length !== 0 && points.length !== count) {
    throw new Error(`KSL ${name} requires ${count} indexed landmarks or an empty observation`);
  }
}

/** Synchronized Holistic -> x/y/z/confidence. No mirroring or handedness swap. */
export function packKslFrame(frame: KslHolisticFrame): Float32Array {
  checkCount(frame.pose, 33, "pose");
  checkCount(frame.leftHand, 21, "left hand");
  checkCount(frame.rightHand, 21, "right hand");
  if (frame.faceMesh.length !== 0 && frame.faceMesh.length !== 468 && frame.faceMesh.length !== 478) {
    throw new Error("KSL requires the full indexed face mesh, not compressed face cues");
  }
  const out = new Float32Array(FRAME_VALUES);
  if (frame.pose.length) {
    const posePoint = (index: number) => pointValues(frame.pose[index], true).map(Math.fround);
    const mean = (a: number[], b: number[]) => a.map((v, i) => i === 3
      ? Math.min(v, b[i]) : Math.fround(Math.fround(v + b[i]) * 0.5));
    const left = posePoint(11), right = posePoint(12);
    const points = [mean(left, right), left, right,
      ...[13, 14, 15, 16, 0, 2, 5, 7, 8].map(posePoint), mean(posePoint(23), posePoint(24))];
    points.forEach((point, index) => out.set(point, index * 4));
  }
  frame.leftHand.forEach((point, index) => out.set(pointValues(point), (13 + index) * 4));
  frame.rightHand.forEach((point, index) => out.set(pointValues(point), (34 + index) * 4));
  if (frame.faceMesh.length) KSL_FACE_INDICES.forEach((index, target) => {
    out.set(pointValues(frame.faceMesh[index]), (55 + target) * 4);
  });
  return out;
}

function roundEven(value: number) {
  const floor = Math.floor(value);
  return value - floor === 0.5 ? floor + (floor % 2) : Math.round(value);
}

/** Already sampled at upstream 15 fps. Match NumPy fitting; zero-pad short clips. */
export function prepareKslInput(frames: readonly KslHolisticFrame[]) {
  if (!frames.length) throw new Error("KSL requires a nonempty isolated-sign clip");
  const values = new Float32Array(KSL_FRAMES * FRAME_VALUES);
  const length = Math.min(frames.length, KSL_FRAMES);
  const step = (frames.length - 1) / (KSL_FRAMES - 1);
  for (let i = 0; i < length; i++) {
    const source = frames.length > KSL_FRAMES ? roundEven(i * step) : i;
    values.set(packKslFrame(frames[source]), i * FRAME_VALUES);
  }
  return { values, length };
}
