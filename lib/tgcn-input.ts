import type { HandObservation, Point, VisionFrame } from "./vision-types";

/**
 * Input construction for the WLASL Pose-TGCN, matched to the publisher's
 * training and test code (dxli94/WLASL code/TGCN/sign_dataset.py):
 *
 * - 55 nodes: OpenPose BODY_25 points 0-8 and 15-18, then the signer's left
 *   hand, then the signer's right hand, each as 2 * (pixel / 256 - 0.5).
 * - Undetected OpenPose points are (0, 0) and so become -1.
 * - Time is NOT normalised. Training took 50 consecutive video frames from a
 *   random start; testing averaged the logits of four consecutive 50-frame
 *   windows ("k_copies"). A shorter clip is padded by repeating its last frame.
 *   The first graph layer is dense over all 50 frames of a node, so a sign that
 *   is stretched or squeezed in time reaches different weights.
 */
export type TgcnTemporal =
  /** Production v1: uniformly resample the whole segment to 50 samples. */
  | { mode: "stretch" }
  /** Publisher protocol on a fixed-rate grid built from frame timestamps. */
  | { mode: "publisher"; fps: number; copies: number };

export type TgcnFraming = {
  /** Training-set medians, in the model's [-1, 1] coordinates. */
  neck: { x: number; y: number };
  shoulderWidth: number;
  /** Neck y minus mean eye y (positive: eyes above the neck). */
  eyeHeight: number;
};

export type TgcnInputOptions = {
  temporal: TgcnTemporal;
  /**
   * "label": trust MediaPipe's handedness label (production v1).
   * "pose-wrist": put each hand in the slot of the nearest pose wrist, as
   * OpenPose does when it crops hands around its own body wrists. The label is
   * only used when the pose cannot decide.
   */
  hands: "label" | "pose-wrist";
  /** Interpolate a missing hand or body point across gaps up to this long.
   * OpenPose still reports blurred hands; MediaPipe drops them. 0 disables. */
  fillGapMs: number;
  /** Map the signer's body framing onto the training distribution. */
  framing: TgcnFraming | null;
  /**
   * MediaPipe Tasks reports `visibility: 0` for every hand landmark: the hand
   * model has no visibility output and the protobuf default is copied through.
   * Production v1 treated that 0 as "not detected" and erased both hands.
   */
  handVisibility: "zero-means-missing" | "ignore";
};

export const PRODUCTION_V1_INPUT: TgcnInputOptions = {
  temporal: { mode: "stretch" }, hands: "label", fillGapMs: 0, framing: null, handVisibility: "zero-means-missing",
};

export const NODE_COUNT = 55;
const BODY_NODES = 13;

type Node = { x: number; y: number } | null;

/** The 13 OpenPose body nodes from one MediaPipe pose, before hands. */
export function openPoseBody(pose: Point[]): Node[] {
  const point = (index: number): Node => {
    const value = pose[index];
    return value && (value.visibility === undefined || value.visibility >= 0.3)
      && Number.isFinite(value.x) && Number.isFinite(value.y) ? { x: value.x, y: value.y } : null;
  };
  const midpoint = (a: Node, b: Node): Node => a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : null;
  // OpenPose: 0 nose, 1 neck, 2-4 right arm, 5-7 left arm, 8 mid-hip,
  // 15 right eye, 16 left eye, 17 right ear, 18 left ear.
  return [
    point(0), midpoint(point(11), point(12)),
    point(12), point(14), point(16),
    point(11), point(13), point(15),
    midpoint(point(23), point(24)),
    point(5), point(2), point(8), point(7),
  ];
}

function handNodes(hand: HandObservation | undefined, visibility: TgcnInputOptions["handVisibility"]): Node[] {
  return Array.from({ length: 21 }, (_, index) => {
    const point = hand?.landmarks[index];
    return point && (visibility === "ignore" || point.visibility !== 0) && Number.isFinite(point.x) && Number.isFinite(point.y)
      ? { x: point.x, y: point.y } : null;
  });
}

const usable = (hand: HandObservation) => hand.landmarks.length === 21
  && hand.landmarks.every(point => Number.isFinite(point.x) && Number.isFinite(point.y));

/** Signer-left and signer-right hands for one frame. */
export function assignHands(frame: VisionFrame, mode: TgcnInputOptions["hands"]): [HandObservation | undefined, HandObservation | undefined] {
  const hands = frame.hands.filter(usable);
  const byLabel = (side: "Left" | "Right") => hands.find(hand => hand.handedness === side);
  if (mode === "label") return [byLabel("Left"), byLabel("Right")];
  const wrist = (index: number) => {
    const point = frame.pose[index];
    return point && (point.visibility ?? 1) >= 0.3 && Number.isFinite(point.x) && Number.isFinite(point.y) ? point : null;
  };
  const poseLeft = wrist(15), poseRight = wrist(16);
  if (!hands.length || !poseLeft || !poseRight) return [byLabel("Left"), byLabel("Right")];
  const distance = (hand: HandObservation, target: Point) =>
    Math.hypot(hand.landmarks[0].x - target.x, hand.landmarks[0].y - target.y);
  if (hands.length >= 2) {
    const [a, b] = hands;
    const straight = distance(a, poseLeft) + distance(b, poseRight);
    const crossed = distance(a, poseRight) + distance(b, poseLeft);
    return straight <= crossed ? [a, b] : [b, a];
  }
  const [hand] = hands;
  const toLeft = distance(hand, poseLeft), toRight = distance(hand, poseRight);
  // When the wrists are close together (crossed or touching hands) the pose
  // cannot tell the hands apart; keep the tracker's label.
  if (Math.abs(toLeft - toRight) < 0.03) return hand.handedness === "Right" ? [undefined, hand] : hand.handedness === "Left" ? [hand, undefined] : [undefined, undefined];
  return toLeft < toRight ? [hand, undefined] : [undefined, hand];
}

/** Per-frame 55-node skeletons in camera-normalised [0, 1] coordinates. */
export function skeletons(sequence: VisionFrame[], options: Pick<TgcnInputOptions, "hands" | "handVisibility">): Node[][] {
  return sequence.map(frame => {
    const [left, right] = assignHands(frame, options.hands);
    return [...openPoseBody(frame.pose), ...handNodes(left, options.handVisibility), ...handNodes(right, options.handVisibility)];
  });
}

/** Linear interpolation of a node across a short gap; never extrapolates
 * beyond the gap limit or across a longer absence. */
export function fillGaps(nodes: Node[][], times: number[], maximumGapMs: number) {
  if (maximumGapMs <= 0) return nodes;
  const filled = nodes.map(frame => [...frame]);
  for (let node = 0; node < NODE_COUNT; node++) {
    let previous = -1;
    for (let index = 0; index < nodes.length; index++) {
      if (!nodes[index][node]) continue;
      if (previous >= 0 && index - previous > 1 && times[index] - times[previous] <= maximumGapMs) {
        const a = nodes[previous][node]!, b = nodes[index][node]!;
        for (let gap = previous + 1; gap < index; gap++) {
          const t = (times[gap] - times[previous]) / (times[index] - times[previous]);
          filled[gap][node] = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        }
      }
      previous = index;
    }
  }
  return filled;
}

function median(values: number[]) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : NaN;
}

/** A per-sequence affine map (no rotation) from the signer's framing to the
 * training framing, from medians so a single bad pose cannot move it. */
export function framingTransform(nodes: Node[][], target: TgcnFraming) {
  const model = (node: Node) => node && { x: 2 * (node.x - 0.5), y: 2 * (node.y - 0.5) };
  const necks = nodes.map(frame => model(frame[1])).filter(Boolean) as { x: number; y: number }[];
  const widths = nodes.map(frame => frame[2] && frame[5] ? Math.abs(2 * (frame[2].x - frame[5].x)) : NaN);
  const heights = nodes.map(frame => {
    const neck = model(frame[1]), right = model(frame[9]), left = model(frame[10]);
    return neck && right && left ? neck.y - (right.y + left.y) / 2 : NaN;
  });
  const neck = { x: median(necks.map(n => n.x)), y: median(necks.map(n => n.y)) };
  const width = median(widths), height = median(heights);
  if (![neck.x, neck.y, width].every(Number.isFinite) || width < 0.05) return null;
  const sx = target.shoulderWidth / width;
  // Without visible eyes, keep the frame's own aspect (equal scaling).
  const sy = Number.isFinite(height) && height > 0.03 ? target.eyeHeight / height : sx;
  return (x: number, y: number) => ({ x: target.neck.x + (x - neck.x) * sx, y: target.neck.y + (y - neck.y) * sy });
}

/** Publisher k_copies indices over 0..count-1 (sign_dataset.py). */
export function kCopiesIndices(count: number, samples: number, copies: number): number[][] {
  if (count <= samples) {
    const window = Array.from({ length: samples }, (_, index) => Math.min(index, count - 1));
    return [window];
  }
  const windows: number[][] = [];
  if (samples * copies < count) {
    const start = Math.floor((count - 1) / 2) - Math.floor(samples * copies / 2);
    for (let copy = 0; copy < copies; copy++) windows.push(Array.from({ length: samples }, (_, i) => start + copy * samples + i));
  } else {
    const stride = Math.floor((count - samples) / (copies - 1));
    for (let copy = 0; copy < copies; copy++) windows.push(Array.from({ length: samples }, (_, i) => copy * stride + i));
  }
  // Identical windows add cost but no information.
  return windows.filter((window, index) => windows.findIndex(other => other[0] === window[0]) === index);
}

/** Frame index shown at each tick of a fixed-rate grid (sample and hold). */
export function fixedRateIndices(times: number[], fps: number) {
  if (!times.length) return [];
  const step = 1000 / fps, indices: number[] = [];
  let source = 0;
  for (let t = times[0]; t <= times[times.length - 1] + 1e-6; t += step) {
    while (source + 1 < times.length && times[source + 1] <= t + 1e-6) source++;
    indices.push(source);
  }
  return indices;
}

/** One or more 55 x (2 * sequenceLength) model inputs; average their logits. */
export function prepareTgcnWindows(sequence: VisionFrame[], options: TgcnInputOptions, sequenceLength = 50): Float32Array[] {
  const features = sequenceLength * 2;
  if (!sequence.length) return [new Float32Array(NODE_COUNT * features).fill(-1)];
  const times = sequence.map(frame => frame.timestamp);
  let nodes = fillGaps(skeletons(sequence, options), times, options.fillGapMs);
  const transform = options.framing ? framingTransform(nodes, options.framing) : null;
  let windows: number[][];
  if (options.temporal.mode === "stretch") {
    windows = [Array.from({ length: sequenceLength }, (_, target) => sequenceLength === 1 ? sequence.length - 1
      : Math.round(target * (sequence.length - 1) / (sequenceLength - 1)))];
  } else {
    const grid = fixedRateIndices(times, options.temporal.fps);
    nodes = grid.map(index => nodes[index]);
    windows = kCopiesIndices(nodes.length, sequenceLength, options.temporal.copies);
  }
  return windows.map(window => {
    const result = new Float32Array(NODE_COUNT * features);
    window.forEach((source, frame) => {
      const skeleton = nodes[source];
      for (let node = 0; node < NODE_COUNT; node++) {
        const offset = node * features + frame * 2;
        const point = skeleton[node];
        if (!point) { result[offset] = -1; result[offset + 1] = -1; continue; }
        const x = 2 * (point.x - 0.5), y = 2 * (point.y - 0.5);
        const mapped = transform ? transform(x, y) : { x, y };
        result[offset] = mapped.x; result[offset + 1] = mapped.y;
      }
    });
    return result;
  });
}

export const BODY_NODE_COUNT = BODY_NODES;
