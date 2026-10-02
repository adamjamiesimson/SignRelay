import type { Point, VisionFrame } from "./vision-types";

export const ASL_CITIZEN_SEQUENCE_LENGTH = 128;
export const ASL_CITIZEN_NODES = 27;

// Exact node subset used by Microsoft's ASL Citizen ST-GCN baseline after it
// reorders [pose, right hand, left hand] into [pose, left hand, right hand].
const KEYPOINTS = [
  0, 2, 5, 11, 12, 13, 14,
  33, 37, 38, 41, 42, 45, 46, 49, 50, 53,
  54, 58, 59, 62, 63, 66, 67, 70, 71, 74,
] as const;

type XY = { x: number; y: number };

const zero = (): XY => ({ x: 0, y: 0 });
const finitePoint = (point: Point | undefined): XY =>
  point && Number.isFinite(point.x) && Number.isFinite(point.y)
    ? { x: point.x, y: point.y }
    : zero();

function raw75(frame: VisionFrame): XY[] {
  const pose = Array.from({ length: 33 }, (_, index) => finitePoint(frame.pose[index]));
  const right = frame.hands.find(hand => hand.handedness === "Right")?.landmarks;
  const left = frame.hands.find(hand => hand.handedness === "Left")?.landmarks;
  const rightPoints = Array.from({ length: 21 }, (_, index) => finitePoint(right?.[index]));
  const leftPoints = Array.from({ length: 21 }, (_, index) => finitePoint(left?.[index]));
  // This mirrors Microsoft's pose.py storage order exactly.
  return [...pose, ...rightPoints, ...leftPoints];
}

function downsample<T>(frames: T[], maximum = ASL_CITIZEN_SEQUENCE_LENGTH) {
  const increment = Math.min(1, maximum / frames.length);
  let currentIncrement = 0;
  let currentFrame = 0;
  const selected: T[] = [];
  for (const frame of frames) {
    currentIncrement += increment;
    if (currentIncrement > currentFrame) {
      currentFrame += 1;
      selected.push(frame);
    }
  }
  return selected.slice(0, maximum);
}

function reorderedSourceIndex(index: number) {
  if (index < 33) return index;
  if (index < 54) return 54 + (index - 33); // left hand
  return 33 + (index - 54); // right hand
}

/**
 * Pack SignRelay VisionFrame observations into Microsoft's ASL Citizen ST-GCN
 * input contract: float32 [2, 128, 27] in channel/time/node order.
 *
 * The slightly unusual normalization order intentionally mirrors the upstream
 * baseline, including zero-padding before shoulder-center/scale computation.
 */
export function prepareAslCitizenInput(sequence: readonly VisionFrame[]): Float32Array {
  let frames = sequence.map(raw75);
  const originalLength = frames.length;
  if (originalLength > ASL_CITIZEN_SEQUENCE_LENGTH) {
    frames = downsample(frames);
  }
  while (frames.length < ASL_CITIZEN_SEQUENCE_LENGTH) {
    frames.push(Array.from({ length: 75 }, zero));
  }
  frames = frames.slice(0, ASL_CITIZEN_SEQUENCE_LENGTH);

  let centerX = 0;
  let centerY = 0;
  let shoulderDistance = 0;
  for (const frame of frames) {
    const left = frame[11];
    const right = frame[12];
    centerX += (left.x + right.x) / 2;
    centerY += (left.y + right.y) / 2;
    shoulderDistance += Math.hypot(left.x - right.x, left.y - right.y);
  }
  centerX /= ASL_CITIZEN_SEQUENCE_LENGTH;
  centerY /= ASL_CITIZEN_SEQUENCE_LENGTH;
  shoulderDistance /= ASL_CITIZEN_SEQUENCE_LENGTH;
  const scale = shoulderDistance !== 0 ? 1 / shoulderDistance : 1;

  const result = new Float32Array(2 * ASL_CITIZEN_SEQUENCE_LENGTH * ASL_CITIZEN_NODES);
  for (let time = 0; time < ASL_CITIZEN_SEQUENCE_LENGTH; time += 1) {
    for (let node = 0; node < KEYPOINTS.length; node += 1) {
      const point = frames[time][reorderedSourceIndex(KEYPOINTS[node])];
      const x = shoulderDistance !== 0 ? (point.x - centerX) * scale : point.x;
      const y = shoulderDistance !== 0 ? (point.y - centerY) * scale : point.y;
      result[time * ASL_CITIZEN_NODES + node] = x;
      result[ASL_CITIZEN_SEQUENCE_LENGTH * ASL_CITIZEN_NODES + time * ASL_CITIZEN_NODES + node] = y;
    }
  }
  return result;
}
