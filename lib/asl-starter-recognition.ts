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
  wrist: Point; circlePath: Point; tip: Point; nose?: Point; mouth?: Point; mouthRadius?: number;
  open: number; indexOpen: boolean; middleOpen: boolean;
  /** Flat hand: all four fingers extended and held together. */
  flat: boolean;
};

/** THANK YOU is made with a flat hand: four extended fingers side by side.
 * Fingertips that are much further apart than the knuckles they grow from are
 * a spread hand (MOTHER, FATHER), and fewer than four extended fingers are
 * another handshape (WATER, CAT). Both leave the mouth with an "open" hand. */
const FINGERS_TOGETHER_RATIO = 1.6;
export function flatHand(hand: HandObservation) {
  if (![8, 12, 16, 20].every(tip => extended(hand, tip))) return false;
  const p = hand.landmarks;
  const tips = distance2(p[8], p[12]) + distance2(p[12], p[16]) + distance2(p[16], p[20]);
  const knuckles = distance2(p[5], p[9]) + distance2(p[9], p[13]) + distance2(p[13], p[17]);
  return knuckles > 0 && tips / knuckles <= FINGERS_TOGETHER_RATIO;
}

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
  const scales = bodySamples.map(sample => sample.reference.scale).sort((a, b) => a - b);
  const firstHand = frames.flatMap(frame => frame.hands).find(hand => hand.handedness === side && validHand(hand));
  // Keep loop geometry in one camera coordinate system. Re-scaling each
  // observation with intermittently refreshed pose estimates distorts loops.
  // Body-relative wrist checks below still require movement over the torso.
  const pathScale = scales[Math.floor(scales.length / 2)] ?? (firstHand ? handScale(firstHand) * 4 : 1);
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
    const faceNose = frame.face[1] ?? frame.pose[0];
    const mouthRadius = faceNose && mouth ? Math.min(distance2(faceNose, mouth) / reference.scale, 0.4) : undefined;
    const center = [0, 5, 9, 13, 17].reduce((p, i) => ({
      x: p.x + hand.landmarks[i].x / 5, y: p.y + hand.landmarks[i].y / 5,
    }), { x: 0, y: 0 });
    samples.push({ hand, circlePath: { x: center.x / pathScale, y: center.y / pathScale, z: 0 },
      mouthRadius, time: frame.timestamp, scale: reference.scale, palm: handScale(hand),
      wrist: point(hand.landmarks[0]), tip: point(hand.landmarks[8]),
      nose: nose && point(nose), mouth: mouth && point(mouth),
      open: [8, 12, 16, 20].filter(tip => extended(hand, tip)).length,
      indexOpen: extended(hand, 8), middleOpen: extended(hand, 12), flat: flatHand(hand),
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
  return analyzeAslStarter(sequence).prediction;
}

/** Conflicting temporal windows are evidence to abstain, not a reason to pick
 * whichever open-palm rule happened to run first. Personal examples keep their
 * independent matcher and are not subject to this fallback-only veto.
 */
export function analyzeAslStarter(sequence: VisionFrame[]) {
  const now = sequence.at(-1)?.timestamp;
  if (now === undefined) return { prediction: null, ambiguousOpenPalm: false, labels: [] as string[], incompleteLabels: [] as string[] };
  let yes: StarterPrediction | null = null;
  let preferred: StarterPrediction | null = null;
  const labels = new Set<string>();
  const incompleteLabels = new Set<string>();
  const previousWindows = new Map<HandObservation["handedness"], VisionFrame[]>();
  for (const duration of [650, 1100, 1700, 2600]) {
    for (const side of ["Right", "Left", "Unknown"] as const) {
      const recent = recentContinuousFrames(sequence, duration,
        frame => frame.hands.some(hand => hand.handedness === side && validHand(hand)));
      // A new track or short recording often produces the same continuous
      // suffix at several durations. Its shape and motion need one evaluation.
      if (recent.length < 5) continue;
      const previous = previousWindows.get(side);
      if (previous?.length === recent.length && recent.every((frame, index) => frame === previous[index])) continue;
      previousWindows.set(side, recent);
      const samples = samplesFor(recent, side);
      if (!samples.length) continue;
      const result = recognizeSamples(samples);
      // A completion veto removes permission to emit a word, not evidence of
      // a competing movement. Otherwise tightening PLEASE exposes a THANK YOU
      // suffix that used to be suppressed by the cross-window ambiguity gate.
      const evidence = recognizeSamples(samples, false);
      if (evidence?.label === "PLEASE" && result?.label !== "PLEASE") incompleteLabels.add("PLEASE");
      // An open-hand departure with weak origin or completion evidence still
      // competes with another open-palm rule on the same stroke.
      if (result?.label !== "THANK YOU" && (evidence?.label === "THANK YOU"
        || (ratio(samples, sample => sample.open >= 3) >= 0.75 && departingMouthStroke(samples)))) {
        incompleteLabels.add("THANK YOU");
      }
      if (result) labels.add(result.label);
      // A short suffix must not override a chest circle visible in a longer
      // window. Keep the whole movement available to distinguish SORRY.
      if (result?.label === "YES") yes = result;
      else if (result && !preferred) preferred = result;
    }
  }
  const ambiguousOpenPalm = ["HELLO", "PLEASE", "THANK YOU"].filter(label => labels.has(label) || incompleteLabels.has(label)).length > 1;
  return { prediction: ambiguousOpenPalm ? null : preferred ?? yes, ambiguousOpenPalm, labels: [...labels], incompleteLabels: [...incompleteLabels] };
}

const span = (values: number[]) => Math.max(...values) - Math.min(...values);
const ratio = (samples: Sample[], predicate: (sample: Sample) => boolean) => samples.filter(predicate).length / samples.length;
const prediction = (label: string, text: string): StarterPrediction => ({ label, text, confidence: 0.86 });

function recognizeSamples(samples: Sample[], requireClosure = true): StarterPrediction | null {
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

  // Preserve the original wrist-only competing evidence. New emitting rules
  // must not erase a partial circle and expose its outward THANK YOU suffix.
  const mouthStart = requireClosure ? departingMouthStroke(samples) : null;
  // On 79 PopSign test clips THANK YOU was right on 3 and wrong on 11, mostly
  // on other signs made at the face. Those use other handshapes.
  const mostlyFlat = ratio(samples, sample => sample.flat) >= 0.6;
  if (mostlyOpen && mostlyFlat && mouthStart && (Math.abs(last.tip.x - mouthStart.tip.x) > 0.15
    || last.palm / mouthStart.palm > 1.14)) return prediction("THANK YOU", "Thank you");

  const nearMouth = first.mouth && distance2(first.tip, first.mouth) < 0.4;
  const outward = Math.abs(last.tip.x - first.tip.x) > 0.15 || last.palm / first.palm > 1.14;
  if (mostlyOpen && mostlyFlat && nearMouth && (!requireClosure || hasMouthOrigin(first))
    && outward && last.tip.y - first.tip.y > 0.12
    && last.mouth && distance2(last.tip, last.mouth) - distance2(first.tip, first.mouth!) > 0.25) {
    return prediction("THANK YOU", "Thank you");
  }

  const raised = ratio(samples, sample => !!sample.nose && sample.wrist.y < sample.nose.y + 0.55) >= 0.7;
  const startsNearHead = first.nose && distance2(first.tip, first.nose) < 0.8;
  if (mostlyOpen && raised && xRange > 0.25 && yRange < Math.max(0.35, xRange * 0.75)
    && (directionChanges(xs, 0.025) >= 1 || startsNearHead)) return prediction("HELLO", "Hello");

  const atChest = ratio(samples, sample => sample.wrist.y > -0.1 && sample.wrist.y < 1.05
    && Math.abs(sample.wrist.x) < 0.8) >= 0.8;
  if (atChest && xRange > 0.1 && yRange > 0.1 && !(mostlyOpen && mouthStart)
    && (requireClosure ? completedPalmCircle(samples) : circularMotion(xs, ys, false))) {
    if (mostlyOpen) return prediction("PLEASE", "Please");
    if (mostlyFist) return prediction("SORRY", "Sorry");
  }

  if (completedFistNod(samples)) return prediction("YES", "Yes");

  if (last.time - first.time >= 280 && ratio(samples,
    sample => sample.hand.gesture === "ILoveYou" && sample.hand.gestureScore >= 0.65) >= 0.8) {
    return prediction("I LOVE YOU", "I love you");
  }
  return null;
}

function hasMouthOrigin(sample: Sample) {
  // The broad proximity fallback can overlap the eyes on small faces.
  // Use the measured nose-to-mouth distance to bound the lip-to-chin region.
  const { mouth, mouthRadius, tip } = sample;
  return mouth && mouthRadius && sample.open >= 3
    && Math.abs(tip.x - mouth.x) <= mouthRadius
    && tip.y >= mouth.y - mouthRadius && tip.y <= mouth.y + 2 * mouthRadius;
}

function completedFistNod(history: Sample[]) {
  // Forming the handshape is preparation, not a nod. Begin after the last
  // clearly open hand, tolerating occasional single-finger tracking noise.
  let start = 0;
  for (let i = 0; i < history.length; i++) if (history[i].open >= 2) start = i + 1;
  const samples = history.slice(start);
  if (samples.length < 5) return false;
  const first = samples[0];
  const last = samples.at(-1)!;
  if (last.time - first.time < 220 || first.open || last.open
    || ratio(samples, sample => sample.open === 0) < 0.8) return false;

  const pitches = fistBendAngles(samples);
  if (!pitches) return false;
  const smooth = pitches.map((pitch, i) => [pitches[Math.max(0, i - 1)], pitch,
    pitches[Math.min(pitches.length - 1, i + 1)]].sort((a, b) => a - b)[1]);
  const excursion = span(smooth);
  if (excursion < 0.35 || span(samples.map(sample => sample.wrist.x)) > 0.25) return false;

  // Wait for a short stable ending, including at slow capture rates. This
  // avoids committing at a turning point while a different sign is unfolding.
  let tail = samples.length - 1;
  while (tail > 0 && last.time - samples[tail].time < 75) tail--;
  if (span(smooth.slice(tail)) > 0.12
    || span(samples.slice(tail).map(s => s.wrist.x)) > 0.035
    || span(samples.slice(tail).map(s => s.wrist.y)) > 0.035) return false;

  // Both halves need substantial evidence. A monotonic tilt, a closing fist,
  // or a tiny reversal at the peak cannot satisfy the return stroke.
  return [1, -1].some(direction => {
    let peak = 0;
    for (let i = 1; i < smooth.length; i++) if (direction * smooth[i] > direction * smooth[peak]) peak = i;
    const outward = direction * (smooth[peak] - smooth[0]);
    const back = direction * (smooth[peak] - smooth.at(-1)!);
    return outward >= 0.35 && back >= Math.max(0.3, outward * 0.65)
      && Math.abs(smooth.at(-1)! - smooth[0]) <= outward * 0.45
      && samples[peak].time - first.time >= 60 && last.time - samples[peak].time >= 60;
  });
}

const subtract = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Point, b: Point): Point => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});

function unit(vector: Point): Point {
  const length = Math.hypot(vector.x, vector.y, vector.z) || 1;
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
}

/** Follow flexion about the index-to-pinky knuckle axis. A fist can nod
 * sideways in the image if photographed from a different angle. Measure its
 * twist in wrist-relative hand coordinates, with no pose/face depth. */
function fistBendAngles(samples: Sample[]) {
  const orientations = samples.map(({ hand: { landmarks } }) => {
    const knuckles = [5, 9, 13, 17].map(index => landmarks[index]);
    const center = knuckles.reduce((p, joint) => ({
      x: p.x + joint.x / 4,
      y: p.y + joint.y / 4,
      z: p.z + joint.z / 4,
    }), { x: 0, y: 0, z: 0 });
    return { axis: unit(subtract(landmarks[5], landmarks[17])), forward: unit(subtract(center, landmarks[0])) };
  });
  const { axis } = orientations[0];
  // A palm roll or changing knuckle axis is different evidence from flexion.
  if (orientations.some(sample => dot(sample.axis, axis) < 0.9 || Math.abs(dot(sample.forward, axis)) > 0.5)) return null;
  const angles = [0];
  for (let index = 1; index < orientations.length; index++) {
    const before = orientations[index - 1].forward;
    const after = orientations[index].forward;
    const projectedDot = dot(before, after) - dot(before, axis) * dot(after, axis);
    const turn = Math.atan2(dot(cross(before, after), axis), projectedDot);
    if (Math.abs(turn) > 1.2) return null;
    angles.push(angles[index - 1] + turn);
  }
  return angles;
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

/** Exported for geometry stress tests only. */
export function circularMotion(xs: number[], ys: number[], requireClosure: boolean) {
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
  const cy = (Math.max(...ys) + Math.min(...ys)) / 2;
  // Normalize the axes: natural chest circles can be narrow ellipses.
  const width = span(xs);
  const height = span(ys);
  if (xs.length < 5 || width <= 0 || height <= 0) return false;
  // The turning angle alone accepts roughly two-thirds of an ellipse as a
  // completed sign. A partial chest sweep or noisy outward stroke can then
  // be mistaken for PLEASE/SORRY before the signer finishes moving.
  // Demand a return near the starting position relative to the actual motion
  // extent. Use proportions so this remains independent of camera distance.
  const closure = Math.hypot(
    (xs.at(-1)! - xs[0]) / width,
    (ys.at(-1)! - ys[0]) / height,
  );
  if (requireClosure && (!Number.isFinite(closure) || closure > 0.45)) return false;
  // A back-and-forth straight stroke passes through the box centre, where each
  // crossing adds an arbitrary +/-pi to the turning angle; two same-signed
  // crossings made a lifted-and-lowered fist look like a full SORRY loop.
  // A real loop encloses area: an ellipse covers pi/4 of its own normalized box.
  let enclosed = 0;
  for (let index = 0; index < xs.length; index++) {
    const next = (index + 1) % xs.length;
    enclosed += ((xs[index] - cx) / width) * ((ys[next] - cy) / height) - ((xs[next] - cx) / width) * ((ys[index] - cy) / height);
  }
  if (Math.abs(enclosed) / 2 < 0.3) return false;
  const angles = xs.map((x, index) => Math.atan2((ys[index] - cy) / height, (x - cx) / width));
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


/** A mouth-origin stroke can include preparation before the hand reaches the
 * lips. Two face-local observations locate that onset independently of the
 * arbitrary rolling-window start. Existing departure/outward limits remain. */
function departingMouthStroke(samples: Sample[]) {
  const near = samples.filter(sample => sample.open >= 3 && sample.mouth && sample.mouthRadius
    && distance2(sample.tip, sample.mouth) <= sample.mouthRadius);
  if (near.length < 2) return null;
  const origin = near.reduce((best, sample) =>
    distance2(sample.tip, sample.mouth!) < distance2(best.tip, best.mouth!) ? sample : best);
  const last = samples.at(-1)!;
  return last.mouth && last.time - origin.time >= 160 && last.tip.y - origin.tip.y > 0.12
    && distance2(last.tip, last.mouth) - distance2(origin.tip, origin.mouth!) > 0.25 ? origin : null;
}

/** Search for a loop ending now, so a continuing second circle is not rejected
 * for failing to return to the beginning of the entire window. Do not revive a
 * completed loop from earlier in a different movement. */
function completedPalmCircle(samples: Sample[]) {
  for (let start = 0; start <= samples.length - 5; start++) {
    if (samples.at(-1)!.time - samples[start].time < 160) break;
    const loop = samples.slice(start);
    const xs = loop.map(sample => sample.circlePath.x), ys = loop.map(sample => sample.circlePath.y);
    if (span(xs) > 0.1 && span(ys) > 0.1 && circularMotion(xs, ys, true)) return true;
  }
  return false;
}
