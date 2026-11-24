import type { Point, VisionFrame } from "./vision-types";

/**
 * Browser reconstruction of the BSL-1K Pose2Sign (body + hands) input contract.
 *
 * Source of truth: github.com/gulvarol/bsl1k (datasets/bsl1k.py `_get_pose`,
 * datasets/videodataset.py `_slide_windows`, misc/bsl1k/save_pose_info.py,
 * evaluate.py `aggregate_clips`). See docs/bsl-sprint-2026-11-24/AUDIT.md.
 *
 * - 25 fps video, 16 *consecutive* frames per clip, sliding windows with a
 *   stride of 8 frames, clip outputs averaged per video.
 * - OpenPose COCO-18 body, then 21-point left hand, then 21-point right hand.
 *   OpenPose crops each hand from its own body wrist, so "left hand" means the
 *   hand at the signer's anatomical left wrist.
 * - x/y divided by the (square-resized) frame size, third channel = OpenPose
 *   confidence. Undetected joints are (0, 0, 0).
 */
export const BSL_FPS = 25;
export const BSL_FRAMES = 16;
export const BSL_STRIDE = 8;
export const BSL_LANDMARKS = 60;
const STEP_MS = 1000 / BSL_FPS;
/** Never interpolate a hand or body point across a gap longer than this. */
const MAX_HOLD_MS = 160;
/** OpenPose emits nothing for joints it cannot see; MediaPipe extrapolates them. */
const MIN_BODY_VISIBILITY = 0.5;
/** A tracked hand within this fraction of shoulder width of its wrist is unambiguous. */
const WRIST_MATCH_RATIO = 0.75;

export type HandSlots = { left?: Point[]; right?: Point[]; method: "pose-wrist" | "tasks-label"; disagreed: boolean };

export type BslInputOptions = {
  /** "pose-wrist" (default): anatomical, as OpenPose built BSL-1K. "tasks-label": raw Tasks handedness. */
  hands?: "pose-wrist" | "tasks-label";
  /** Zero body joints that MediaPipe reports as not visible or outside the image (OpenPose behaviour). */
  zeroInvisibleBody?: boolean;
};

const DEFAULTS: Required<BslInputOptions> = { hands: "pose-wrist", zeroInvisibleBody: true };

// OpenPose COCO-18: nose, neck, R shoulder/elbow/wrist, L shoulder/elbow/wrist,
// R hip/knee/ankle, L hip/knee/ankle, R eye, L eye, R ear, L ear. MediaPipe
// pose landmarks are named for the signer's anatomical side.
const COCO18_FROM_MEDIAPIPE = [0, -1, 12, 14, 16, 11, 13, 15, 24, 26, 28, 23, 25, 27, 5, 2, 8, 7] as const;

function usable(point: Point | undefined): point is Point {
  return Boolean(point && Number.isFinite(point.x) && Number.isFinite(point.y));
}

function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function visibleWrist(pose: Point[], index: number) {
  const point = pose[index];
  return usable(point) && (point.visibility ?? 1) >= MIN_BODY_VISIBILITY ? point : undefined;
}

/**
 * Put each tracked hand in the slot of the body wrist it belongs to, as
 * OpenPose did for the training data. Falls back to the Tasks handedness label
 * only when the body wrists cannot settle the question.
 */
export function assignHandSlots(frame: VisionFrame, mode: BslInputOptions["hands"] = "pose-wrist"): HandSlots {
  const hands = frame.hands.filter(hand => hand.landmarks.length >= 21 && usable(hand.landmarks[0]));
  const byLabel = (side: "Left" | "Right") => hands.find(hand => hand.handedness === side)?.landmarks;
  const labelled: HandSlots = { left: byLabel("Left"), right: byLabel("Right"), method: "tasks-label", disagreed: false };
  if (mode === "tasks-label" || !hands.length) return labelled;
  const leftWrist = visibleWrist(frame.pose, 15), rightWrist = visibleWrist(frame.pose, 16);
  const shoulders = usable(frame.pose[11]) && usable(frame.pose[12]) ? distance(frame.pose[11], frame.pose[12]) : 0;
  if (!leftWrist || !rightWrist || shoulders <= 0) return labelled;
  let slots: HandSlots;
  if (hands.length >= 2) {
    const [a, b] = hands;
    const straight = distance(a.landmarks[0], leftWrist) + distance(b.landmarks[0], rightWrist);
    const crossed = distance(a.landmarks[0], rightWrist) + distance(b.landmarks[0], leftWrist);
    slots = straight <= crossed
      ? { left: a.landmarks, right: b.landmarks, method: "pose-wrist", disagreed: false }
      : { left: b.landmarks, right: a.landmarks, method: "pose-wrist", disagreed: false };
  } else {
    const hand = hands[0];
    const toLeft = distance(hand.landmarks[0], leftWrist), toRight = distance(hand.landmarks[0], rightWrist);
    const nearest = Math.min(toLeft, toRight), other = Math.max(toLeft, toRight);
    // Body pose is refreshed less often than hands. Only overrule the label
    // when one wrist is clearly closer and the hand is plausibly attached to it.
    if (nearest > WRIST_MATCH_RATIO * shoulders || nearest > 0.6 * other) return labelled;
    slots = toLeft < toRight ? { left: hand.landmarks, method: "pose-wrist", disagreed: false }
      : { right: hand.landmarks, method: "pose-wrist", disagreed: false };
  }
  slots.disagreed = (slots.left !== undefined && slots.left !== labelled.left)
    || (slots.right !== undefined && slots.right !== labelled.right);
  return slots;
}

type Keypoints = Float32Array; // 60 × (x, y, score)

/** One observed frame in Pose2Sign order. Missing points stay (0, 0, 0). */
export function frameKeypoints(frame: VisionFrame, options: BslInputOptions = {}): { values: Keypoints; slots: HandSlots } {
  const settings = { ...DEFAULTS, ...options };
  const values = new Float32Array(BSL_LANDMARKS * 3);
  const put = (index: number, point: Point | undefined, score = 1) => {
    if (!usable(point) || !(score > 0)) return;
    values[index * 3] = point.x;
    values[index * 3 + 1] = point.y;
    values[index * 3 + 2] = score;
  };
  const bodyPoint = (mediapipe: number) => {
    const point = frame.pose[mediapipe];
    if (!usable(point)) return undefined;
    const visibility = point.visibility ?? 1;
    if (settings.zeroInvisibleBody && (visibility < MIN_BODY_VISIBILITY || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1)) return undefined;
    return point;
  };
  COCO18_FROM_MEDIAPIPE.forEach((mediapipe, index) => {
    if (mediapipe >= 0) {
      const point = bodyPoint(mediapipe);
      put(index, point, point?.visibility ?? 1);
      return;
    }
    const left = bodyPoint(11), right = bodyPoint(12);
    if (left && right) put(index, { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2, z: 0 },
      Math.min(left.visibility ?? 1, right.visibility ?? 1));
  });
  const slots = assignHandSlots(frame, settings.hands);
  slots.left?.slice(0, 21).forEach((point, index) => put(18 + index, point));
  slots.right?.slice(0, 21).forEach((point, index) => put(39 + index, point));
  return { values, slots };
}

/** `until`: last time the same (held) values were still being reported. */
type Track = { time: number; until: number; values: Float32Array }[];

function sameValues(a: Float32Array, b: Float32Array, from: number, to: number) {
  for (let index = from; index < to; index++) if (a[index] !== b[index]) return false;
  return true;
}

/** Linear interpolation per landmark between real observations no more than MAX_HOLD_MS apart. */
function sampleTrack(track: Track, time: number, out: Float32Array, from: number, to: number) {
  let next = track.findIndex(entry => entry.time >= time);
  if (next < 0) next = track.length;
  const before = track[next - 1], after = track[next];
  for (let landmark = from; landmark < to; landmark++) {
    const offset = landmark * 3;
    const has = (entry?: Track[number]) => Boolean(entry && entry.values[offset + 2] > 0);
    const a = has(before) ? before : undefined, b = has(after) ? after : undefined;
    if (a && b && b.time - a.time <= MAX_HOLD_MS) {
      const weight = b.time === a.time ? 0 : (time - a.time) / (b.time - a.time);
      for (let axis = 0; axis < 3; axis++) out[offset + axis] = a.values[offset + axis] * (1 - weight) + b.values[offset + axis] * weight;
    } else {
      // Nearest real observation within one model frame; a held value counts until it was last reported.
      const gap = (entry: Track[number]) => time < entry.time ? entry.time - time : Math.max(0, time - entry.until);
      const nearest = [a, b].filter((entry): entry is Track[number] => Boolean(entry)).sort((x, y) => gap(x) - gap(y))[0];
      if (nearest && gap(nearest) <= STEP_MS) for (let axis = 0; axis < 3; axis++) out[offset + axis] = nearest.values[offset + axis];
    }
  }
}

export type BslTimeline = {
  /** Resampled 25 fps keypoints, oldest first. */
  frames: Float32Array[];
  times: number[];
  /** Frames where at least one hand is present after resampling. */
  handFrames: number;
  /** Observed frames whose anatomical slot disagreed with the Tasks label. */
  slotDisagreements: number;
  observedHandFrames: number;
};

/**
 * Resample observations onto the model's 25 fps grid. Body pose is refreshed
 * less often than hands in VisionEngine, so repeated (held) body values are
 * treated as one observation and interpolated instead of stair-stepped.
 */
export function resampleBslTimeline(sequence: VisionFrame[], options: BslInputOptions = {}): BslTimeline {
  const body: Track = [], hands: Track = [];
  let slotDisagreements = 0, observedHandFrames = 0;
  for (const frame of sequence) {
    if (!Number.isFinite(frame.timestamp)) continue;
    const { values, slots } = frameKeypoints(frame, options);
    if (slots.left || slots.right) observedHandFrames++;
    if (slots.disagreed) slotDisagreements++;
    const previous = body.at(-1);
    if (!previous || !sameValues(previous.values, values, 0, 18 * 3)) body.push({ time: frame.timestamp, until: frame.timestamp, values });
    else previous.until = frame.timestamp;
    hands.push({ time: frame.timestamp, until: frame.timestamp, values });
  }
  const start = sequence[0]?.timestamp, end = sequence.at(-1)?.timestamp;
  const frames: Float32Array[] = [], times: number[] = [];
  let handFrames = 0;
  if (Number.isFinite(start) && Number.isFinite(end)) {
    for (let time = start!; time <= end! + 1e-6; time += STEP_MS) {
      const out = new Float32Array(BSL_LANDMARKS * 3);
      sampleTrack(body, time, out, 0, 18);
      sampleTrack(hands, time, out, 18, BSL_LANDMARKS);
      let present = false;
      for (let landmark = 18; landmark < BSL_LANDMARKS && !present; landmark += 21) present = out[landmark * 3 + 2] > 0;
      if (present) handFrames++;
      frames.push(out); times.push(time);
    }
  }
  return { frames, times, handFrames, slotDisagreements, observedHandFrames };
}

/** Per-frame hand activity: wrist displacement relative to shoulder width. */
function activity(frames: Float32Array[]) {
  const speeds = frames.map(() => 0);
  for (let index = 1; index < frames.length; index++) {
    const now = frames[index], before = frames[index - 1];
    const shoulder = Math.hypot(now[2 * 3] - now[5 * 3], now[2 * 3 + 1] - now[5 * 3 + 1]) || 0.25;
    let speed = 0;
    for (const wrist of [18, 39]) {
      const o = wrist * 3;
      if (now[o + 2] > 0 && before[o + 2] > 0) speed = Math.max(speed, Math.hypot(now[o] - before[o], now[o + 1] - before[o + 1]) / shoulder);
    }
    speeds[index] = speed;
  }
  // Short centred smoothing suppresses single-frame landmark jitter.
  return speeds.map((_, index) => {
    const window = speeds.slice(Math.max(0, index - 2), index + 3);
    return window.reduce((sum, value) => sum + value, 0) / window.length;
  });
}

export type BslSpan = { start: number; end: number; peak: number };

/**
 * The most recent stretch of deliberate hand movement. Pose2Sign was trained
 * on windows overlapping the sign itself, not on the rest pose after it.
 */
export function selectSignSpan(frames: Float32Array[]): BslSpan | null {
  if (!frames.length) return null;
  const speeds = activity(frames);
  const peak = Math.max(...speeds);
  if (!(peak > 0)) return null;
  const threshold = Math.max(0.012, peak * 0.2);
  let end = -1;
  for (let index = speeds.length - 1; index >= 0; index--) if (speeds[index] >= threshold) { end = index; break; }
  if (end < 0) return null;
  let start = end, quiet = 0;
  for (let index = end - 1; index >= 0; index--) {
    if (speeds[index] >= threshold) { start = index; quiet = 0; } else if (++quiet > 5) break;
  }
  return { start, end, peak };
}

/** Sliding 16-frame windows (stride 8) covering the span, clamped to the buffer. */
export function windowStarts(length: number, span: BslSpan | null): number[] {
  if (length < BSL_FRAMES) return [];
  const clamp = (start: number) => Math.min(Math.max(0, start), length - BSL_FRAMES);
  if (!span) return [length - BSL_FRAMES];
  // Include a little preparation and hold, as clips around the mouthing did.
  const from = Math.max(0, span.start - 2), to = Math.min(length - 1, span.end + 2);
  const spanLength = to - from + 1;
  if (spanLength <= BSL_FRAMES) return [clamp(Math.round((from + to + 1 - BSL_FRAMES) / 2))];
  const starts: number[] = [];
  for (let start = from; start + BSL_FRAMES <= to + 1; start += BSL_STRIDE) starts.push(start);
  if (starts.at(-1)! + BSL_FRAMES < to + 1) starts.push(to + 1 - BSL_FRAMES);
  return [...new Set(starts.map(clamp))];
}

/** Pack one [3, 16, 60] window (channel-major), as in `_get_pose(...).permute(2, 0, 1)`. */
export function packWindow(frames: Float32Array[], start: number) {
  const values = new Float32Array(3 * BSL_FRAMES * BSL_LANDMARKS);
  for (let frame = 0; frame < BSL_FRAMES; frame++) {
    const source = frames[start + frame];
    for (let landmark = 0; landmark < BSL_LANDMARKS; landmark++) {
      for (let channel = 0; channel < 3; channel++) {
        values[channel * BSL_FRAMES * BSL_LANDMARKS + frame * BSL_LANDMARKS + landmark] = source[landmark * 3 + channel];
      }
    }
  }
  return values;
}

export type BslWindows = { windows: Float32Array[]; starts: number[]; span: BslSpan | null; timeline: BslTimeline };

export function buildBslWindows(sequence: VisionFrame[], options: BslInputOptions = {}): BslWindows {
  const timeline = resampleBslTimeline(sequence, options);
  const span = selectSignSpan(timeline.frames);
  const starts = windowStarts(timeline.frames.length, span);
  return { windows: starts.map(start => packWindow(timeline.frames, start)), starts, span, timeline };
}
