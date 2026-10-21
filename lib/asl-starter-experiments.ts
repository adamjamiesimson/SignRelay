import { analyzeAslStarter, bodyReference, validHand } from "./asl-starter-recognition";
import { recentContinuousFrames } from "./frame-timing";
import type { HandObservation, Point, VisionFrame } from "./vision-types";

/** Evaluation-only variants of the ASL starter rules. Nothing in the app or the
 * recognition worker imports this module, so production bytes and decisions
 * are unchanged; every experiment is off unless a test or evaluation harness
 * passes it explicitly. Results on synthetic fixtures are not evidence that an
 * experiment helps real signers. */
export const EXPERIMENTS = {
  "hello-sideways-stroke": {
    objective: 8,
    description: "Veto HELLO when the stroke is mainly vertical (toward the forehead, or down from the mouth) or is a repeated wave of three or more reversals.",
    targets: ["raising an open hand from the chin toward the forehead", "blowing a kiss", "waving to someone across the room"],
  },
  "thank-you-not-from-eyes": {
    objective: 9,
    description: "Veto THANK YOU when the fingertips were above the nose earlier in the stroke, i.e. the hand came down from the eyes or brow rather than starting at the mouth.",
    targets: ["adjusting glasses", "pushing glasses up the nose", "shielding the eyes from light"],
  },
  "thank-you-over-incomplete-please": {
    objective: 9,
    description: "When the only competing open-palm evidence is an incomplete PLEASE circle, emit the completed THANK YOU instead of abstaining.",
    targets: ["THANK YOU recall when a partial chest circle precedes the mouth stroke"],
  },
  "yes-gap-fill": {
    objective: 10,
    description: "If no rule matches, interpolate hand gaps of up to two frames (at most 200 ms) and accept only a YES from the filled sequence.",
    targets: ["YES under sparse hand tracking"],
  },
} as const;
export type ExperimentId = keyof typeof EXPERIMENTS;

type Track = { tip: Point; wrist: Point; nose?: Point; mouth?: Point };
function track(frames: VisionFrame[], side: HandObservation["handedness"]): Track[] {
  return frames.flatMap(frame => {
    const hand = frame.hands.find(candidate => candidate.handedness === side && validHand(candidate));
    if (!hand) return [];
    const { anchor, scale } = bodyReference(frame, hand);
    const norm = (p: Point | undefined) => p && { x: (p.x - anchor.x) / scale, y: (p.y - anchor.y) / scale, z: 0 };
    return [{ tip: norm(hand.landmarks[8])!, wrist: norm(hand.landmarks[0])!, nose: norm(frame.pose[0] ?? frame.face[1]), mouth: norm(frame.face[3] ?? frame.pose[9]) }];
  });
}

function reversals(values: number[], epsilon: number) {
  let previous = 0, anchor = values[0], changes = 0;
  for (const value of values.slice(1)) {
    if (Math.abs(value - anchor) < epsilon) continue;
    const direction = Math.sign(value - anchor);
    if (previous && previous !== direction) changes++;
    previous = direction; anchor = value;
  }
  return changes;
}

const activeSide = (sequence: VisionFrame[]) => sequence.at(-1)?.hands.find(validHand)?.handedness;
const recentTrack = (sequence: VisionFrame[], duration: number) => {
  const side = activeSide(sequence);
  if (!side) return [];
  return track(recentContinuousFrames(sequence, duration, frame => frame.hands.some(hand => hand.handedness === side && validHand(hand))), side);
};

/** True when the recent HELLO candidate is not a mainly sideways stroke. */
export function helloVeto(sequence: VisionFrame[]) {
  const samples = recentTrack(sequence, 1700);
  if (samples.length < 3) return false;
  const xs = samples.map(s => s.wrist.x), first = samples[0].wrist, last = samples.at(-1)!.wrist;
  const vertical = Math.abs(last.y - first.y), horizontal = Math.abs(last.x - first.x);
  return reversals(xs, 0.05) >= 3 || (vertical > 0.2 && vertical > 0.6 * horizontal);
}

/** True when the fingertips were above the nose before the hand's last pass by the mouth. */
export function thankYouVeto(sequence: VisionFrame[]) {
  // Look back over the whole continuous stroke (the worker buffers about 5 s).
  const samples = recentTrack(sequence, 4000).filter(s => s.mouth && s.nose);
  // The departure starts at the last observation near the mouth. A hand coming
  // down from the eyes also passes the mouth on the way up, so the first or
  // closest pass is not the origin.
  let origin = -1;
  samples.forEach((s, i) => { if (Math.hypot(s.tip.x - s.mouth!.x, s.tip.y - s.mouth!.y) < 0.25) origin = i; });
  return origin > 0 && samples.slice(0, origin).some(s => s.tip.y < s.nose!.y - 0.05);
}

/** Linear interpolation of short hand gaps; never extends past the newest observation. */
export function fillHandGaps(sequence: VisionFrame[], maxFrames = 2, maxMs = 200): VisionFrame[] {
  const side = activeSide(sequence);
  if (!side) return sequence;
  const has = (frame: VisionFrame) => frame.hands.find(hand => hand.handedness === side && validHand(hand));
  const out = sequence.map(frame => ({ ...frame }));
  for (let i = 0; i < sequence.length; i++) {
    const before = has(sequence[i]);
    if (!before) continue;
    let j = i + 1;
    while (j < sequence.length && !has(sequence[j])) j++;
    const gap = j - i - 1;
    if (j >= sequence.length || gap === 0 || gap > maxFrames || sequence[j].timestamp - sequence[i].timestamp > maxMs) continue;
    const after = has(sequence[j])!;
    for (let k = i + 1; k < j; k++) {
      const f = (sequence[k].timestamp - sequence[i].timestamp) / (sequence[j].timestamp - sequence[i].timestamp);
      const landmarks = before.landmarks.map((p, n) => ({ x: p.x + (after.landmarks[n].x - p.x) * f, y: p.y + (after.landmarks[n].y - p.y) * f, z: p.z + (after.landmarks[n].z - p.z) * f }));
      out[k] = { ...sequence[k], hands: [...sequence[k].hands, { ...before, landmarks }] };
    }
  }
  return out;
}

/** analyzeAslStarter with the given experiments applied; with none it is exactly analyzeAslStarter. */
export function analyzeWithExperiments(sequence: VisionFrame[], enabled: readonly ExperimentId[] = [], analyze = analyzeAslStarter) {
  const base = analyze(sequence);
  if (!enabled.length) return base;
  const on = new Set(enabled);
  let result = base;
  if (on.has("thank-you-over-incomplete-please") && !base.prediction && base.ambiguousOpenPalm
    && base.labels.includes("THANK YOU") && !base.labels.includes("PLEASE") && !base.labels.includes("HELLO")
    && !base.incompleteLabels.includes("HELLO") && base.incompleteLabels.includes("PLEASE"))
    result = { ...base, ambiguousOpenPalm: false, prediction: { label: "THANK YOU", text: "Thank you", confidence: 0.86 } };
  if (on.has("yes-gap-fill") && !result.prediction && !result.ambiguousOpenPalm) {
    const filled = analyze(fillHandGaps(sequence));
    if (filled.prediction?.label === "YES") result = { ...result, prediction: filled.prediction };
  }
  if (on.has("hello-sideways-stroke") && result.prediction?.label === "HELLO" && helloVeto(sequence)) result = { ...result, prediction: null };
  if (on.has("thank-you-not-from-eyes") && result.prediction?.label === "THANK YOU" && thankYouVeto(sequence)) result = { ...result, prediction: null };
  return result;
}
