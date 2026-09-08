import type { HandObservation, Point, VisionFrame } from "./vision-types";
import { recentContinuousFrames } from "./frame-timing";

export type StarterPrediction = { label: string; text: string; confidence: number };

export function validHand(hand: HandObservation | undefined): hand is HandObservation {
  return !!hand && hand.landmarks.length === 21
    && hand.landmarks.every(point => [point.x, point.y, point.z].every(Number.isFinite));
}

export const distance2 = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
export const handScale = (hand: HandObservation) => Math.max(
  distance2(hand.landmarks[0], hand.landmarks[9]),
  distance2(hand.landmarks[5], hand.landmarks[17]), 0.015,
);

export function bodyReference(frame: VisionFrame, hand: HandObservation) {
  const shoulders = [frame.pose[11], frame.pose[12]];
  const tracked = shoulders.every(point => point && (point.visibility ?? 1) > 0.4
    && [point.x, point.y].every(Number.isFinite));
  return {
    anchor: tracked ? {
      x: (shoulders[0].x + shoulders[1].x) / 2,
      y: (shoulders[0].y + shoulders[1].y) / 2, z: 0,
    } : { x: 0.5, y: 0.5, z: 0 },
    scale: tracked ? Math.max(distance2(shoulders[0], shoulders[1]), 0.08) : handScale(hand) * 4,
    tracked,
  };
}

type Sample = {
  hand: HandObservation; time: number; scale: number; palm: number;
  wrist: Point; knuckle: Point; tip: Point; nose?: Point; mouth?: Point;
  open: number; indexOpen: boolean; middleOpen: boolean;
};

function extended(hand: HandObservation, tip: number) {
  const p = hand.landmarks;
  return distance2(p[tip], p[tip - 3]) > distance2(p[tip - 2], p[tip - 3]) * 1.55
    && distance2(p[tip], p[0]) > distance2(p[tip - 2], p[0]) * 1.08;
}

function samplesFor(frames: VisionFrame[], side: HandObservation["handedness"]): Sample[] {
  const samples: Sample[] = [];
  const bodySamples = frames.flatMap(frame => {
    const hand = frame.hands.find(hand => hand.handedness === side && validHand(hand));
    if (!hand) return [];
    const reference = bodyReference(frame, hand);
    return reference.tracked ? [{ time: frame.timestamp, reference }] : [];
  });
  for (const frame of frames) {
    const hand = frame.hands.find(hand => hand.handedness === side && validHand(hand));
    if (!hand) continue;
    const currentReference = bodyReference(frame, hand);
    const nearest = bodySamples.reduce<typeof bodySamples[number] | undefined>((best, sample) =>
      !best || Math.abs(sample.time - frame.timestamp) < Math.abs(best.time - frame.timestamp) ? sample : best, undefined);
    const reference = currentReference.tracked ? currentReference : nearest?.reference ?? currentReference;
    const point = (p: Point): Point => ({ x: (p.x - reference.anchor.x) / reference.scale,
      y: (p.y - reference.anchor.y) / reference.scale, z: p.z });
    const nose = frame.pose[0] ?? frame.face[1];
    const mouth = frame.face[3] ?? frame.pose[9] ?? nose;
    samples.push({ hand, time: frame.timestamp, scale: reference.scale, palm: handScale(hand),
      wrist: point(hand.landmarks[0]), knuckle: point(hand.landmarks[9]), tip: point(hand.landmarks[8]),
      nose: nose && point(nose), mouth: mouth && point(mouth),
      open: [8, 12, 16, 20].filter(tip => extended(hand, tip)).length,
      indexOpen: extended(hand, 8), middleOpen: extended(hand, 12),
    });
  }
  // A brief dropped frame is tolerable; absent current hands and long gaps are not evidence.
  if (samples.length < 5 || samples.length / frames.length < 0.6
    || samples.at(-1)?.time !== frames.at(-1)?.timestamp
    || samples.at(-1)!.time - samples[0].time < 160) return [];
  return samples;
}

/** Limited, explicit ASL fallback rules, not a calibrated general sign-language model.
 * See docs/asl-dynamic-recognition.md for references and evaluation limitations.
 */
export function recognizeAslStarter(sequence: VisionFrame[]): StarterPrediction | null {
  const now = sequence.at(-1)?.timestamp;
  if (now === undefined) return null;
  for (const duration of [650, 1100, 1700, 2600]) {
    for (const side of ["Right", "Left", "Unknown"] as const) {
      const recent = recentContinuousFrames(sequence, duration,
        frame => frame.hands.some(hand => hand.handedness === side && validHand(hand)));
      const samples = samplesFor(recent, side);
      if (!samples.length) continue;
      const result = recognizeSamples(samples);
      if (result) return result;
    }
  }
  return null;
}

const span = (values: number[]) => Math.max(...values) - Math.min(...values);
const ratio = (samples: Sample[], predicate: (sample: Sample) => boolean) => samples.filter(predicate).length / samples.length;
const prediction = (label: string, text: string): StarterPrediction => ({ label, text, confidence: 0.86 });

function recognizeSamples(samples: Sample[]): StarterPrediction | null {
  const first = samples[0];
  const last = samples.at(-1)!;
  const mostlyOpen = ratio(samples, sample => sample.open >= 3) >= 0.75;
  const mostlyFist = ratio(samples, sample => sample.open <= 1) >= 0.8;
  const xs = samples.map(sample => sample.wrist.x);
  const ys = samples.map(sample => sample.wrist.y);
  const xRange = span(xs);
  const yRange = span(ys);

  // NO articulates index AND middle fingers toward the thumb; the wrist may be still.
  const gaps = (sample: Sample) => [8, 12].map(index =>
    distance2(sample.hand.landmarks[index], sample.hand.landmarks[4]) / sample.palm);
  const endGaps = gaps(last);
  const opening = samples.slice(0, -2).find(sample => sample.indexOpen && sample.middleOpen
    && !extended(sample.hand, 16) && !extended(sample.hand, 20)
    && gaps(sample).every((gap, index) => gap - endGaps[index] > 0.5));
  if (opening && endGaps.every(gap => gap < 0.8)
    && ratio(samples, sample => !extended(sample.hand, 16) && !extended(sample.hand, 20)) >= 0.8) {
    return prediction("NO", "No");
  }

  const nearMouth = first.mouth && distance2(first.tip, first.mouth) < 0.4;
  const outward = Math.abs(last.tip.x - first.tip.x) > 0.15 || last.palm / first.palm > 1.14;
  if (mostlyOpen && nearMouth && outward && last.tip.y - first.tip.y > 0.12
    && last.mouth && distance2(last.tip, last.mouth) - distance2(first.tip, first.mouth!) > 0.25) {
    return prediction("THANK YOU", "Thank you");
  }

  const raised = ratio(samples, sample => !!sample.nose && sample.wrist.y < sample.nose.y + 0.55) >= 0.7;
  const startsNearHead = first.nose && distance2(first.tip, first.nose) < 0.8;
  if (mostlyOpen && raised && xRange > 0.25 && yRange < Math.max(0.35, xRange * 0.75)
    && (directionChanges(xs, 0.025) >= 1 || startsNearHead)) return prediction("HELLO", "Hello");

  const atChest = ratio(samples, sample => sample.wrist.y > -0.1 && sample.wrist.y < 1.05
    && Math.abs(sample.wrist.x) < 0.8) >= 0.8;
  if (atChest && xRange > 0.16 && yRange > 0.16 && circularMotion(xs, ys)) {
    if (mostlyOpen) return prediction("PLEASE", "Please");
    if (mostlyFist) return prediction("SORRY", "Sorry");
  }

  const knuckleYs = samples.map(sample => sample.knuckle.y);
  if (mostlyFist && span(knuckleYs) > 0.16 && span(knuckleYs) > xRange * 1.5
    && directionChanges(knuckleYs, 0.025) >= 1) return prediction("YES", "Yes");

  if (last.time - first.time >= 280 && ratio(samples,
    sample => sample.hand.gesture === "ILoveYou" && sample.hand.gestureScore >= 0.65) >= 0.8) {
    return prediction("I LOVE YOU", "I love you");
  }
  return null;
}

function directionChanges(values: number[], epsilon: number) {
  let previous = 0;
  let anchor = values[0];
  let changes = 0;
  for (const value of values.slice(1)) {
    if (Math.abs(value - anchor) < epsilon) continue;
    const direction = Math.sign(value - anchor);
    if (previous && previous !== direction) changes++;
    previous = direction;
    anchor = value;
  }
  return changes;
}

function circularMotion(xs: number[], ys: number[]) {
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
  const cy = (Math.max(...ys) + Math.min(...ys)) / 2;
  const angles = xs.map((x, index) => Math.atan2(ys[index] - cy, x - cx));
  let turn = 0;
  let travel = 0;
  for (let index = 1; index < angles.length; index++) {
    let delta = angles[index] - angles[index - 1];
    if (delta > Math.PI) delta -= 2 * Math.PI;
    if (delta < -Math.PI) delta += 2 * Math.PI;
    turn += delta;
    travel += Math.abs(delta);
  }
  return Math.abs(turn) > 4.2 && Math.abs(turn) / Math.max(travel, 0.01) > 0.8;
}
