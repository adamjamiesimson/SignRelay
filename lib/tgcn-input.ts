import type { HandObservation, Point, VisionFrame } from "./vision-types";

export const NODE_COUNT = 55;
export const BODY_NODE_COUNT = 13;
const PUBLISHER_FPS = 25;

// Medians from 300 WLASL training clips. The released pose data is in a
// tighter crop than the camera input, so map the camera framing into its units.
const TRAINING_FRAME = { neck: { x: 0.0243, y: -0.0054 }, shoulderWidth: 0.6474, eyeHeight: 0.4425 };
type Node = { x: number; y: number } | null;

/** The 13 OpenPose body nodes from one MediaPipe pose, before hands. */
function openPoseBody(pose: Point[]): Node[] {
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

function handNodes(hand: HandObservation | undefined): Node[] {
  // Tasks hand landmarks carry visibility=0 because that optional protobuf
  // field is unset. The detector's presence of a complete hand is the signal.
  return Array.from({ length: 21 }, (_, index) => {
    const point = hand?.landmarks[index];
    return point && Number.isFinite(point.x) && Number.isFinite(point.y)
      ? { x: point.x, y: point.y } : null;
  });
}

const usable = (hand: HandObservation) => hand.landmarks.length === 21
  && hand.landmarks.every(point => Number.isFinite(point.x) && Number.isFinite(point.y));

/** Signer-left and signer-right hands for one frame. */
export function assignHands(frame: VisionFrame): [HandObservation | undefined, HandObservation | undefined] {
  const hands = frame.hands.filter(usable);
  const byLabel = (side: "Left" | "Right") => hands.find(hand => hand.handedness === side);
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

function median(values: number[]) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : NaN;
}

/** A per-sequence affine map (no rotation) from the signer's framing to the
 * training framing, from medians so a single bad pose cannot move it. */
function framingTransform(nodes: Node[][]) {
  const target = TRAINING_FRAME;
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

/** Build one WLASL Pose-TGCN window. The publisher's checkpoint uses 50
 * consecutive frames, never a stretched sequence, and repeats the last
 * frame for padding. Starting at the observed movement avoids shifting the
 * sign's onset when extra settled frames arrive from the camera.
 */
export function prepareAsl2000Input(sequence: VisionFrame[], sequenceLength = 50) {
  const features = sequenceLength * 2;
  const input = new Float32Array(NODE_COUNT * features).fill(-1);
  if (!sequence.length) return input;
  const skeletons = sequence.map(frame => {
    const [left, right] = assignHands(frame);
    return [...openPoseBody(frame.pose), ...handNodes(left), ...handNodes(right)];
  });
  const transform = framingTransform(skeletons);
  const start = sequence[0].timestamp;
  const end = sequence.at(-1)!.timestamp;
  // Sample-and-hold on a 25 fps grid. Keep the last grid sample when the
  // clip ends before the checkpoint's 50-frame window does.
  let source = 0;
  for (let frame = 0; frame < sequenceLength; frame++) {
    const at = start + frame * 1000 / PUBLISHER_FPS;
    if (at <= end + 1e-6) {
      while (source + 1 < sequence.length && sequence[source + 1].timestamp <= at + 1e-6) source++;
    }
    for (let node = 0; node < NODE_COUNT; node++) {
      const point = skeletons[source][node];
      if (!point) continue;
      const x = 2 * (point.x - 0.5), y = 2 * (point.y - 0.5);
      const mapped = transform ? transform(x, y) : { x, y };
      const offset = node * features + frame * 2;
      input[offset] = mapped.x;
      input[offset + 1] = mapped.y;
    }
  }
  return input;
}
