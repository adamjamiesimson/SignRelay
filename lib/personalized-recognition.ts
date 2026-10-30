import type { CalibrationTemplate, Point, VisionFrame } from "./vision-types";
import { validHand } from "./asl-starter-recognition";
import { recentContinuousFrames } from "./frame-timing";

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
const ZERO_POSE = new Array(67).fill(0);

export function prepareCalibrationSequence(frames: VisionFrame[], normalization?: CalibrationTemplate["normalization"]) {
  if (!frames.length) return [];
  const references = normalization === "trajectory-v3" ? frames.flatMap(frame => {
    const shoulders = [frame.pose[11], frame.pose[12]];
    return shoulders.every(p => p && (p.visibility ?? 1) > 0.4 && [p.x, p.y, p.z].every(Number.isFinite))
      ? [{ timestamp: frame.timestamp, anchor: midpoint(shoulders[0], shoulders[1]), bodyScale: Math.max(distance(shoulders[0], shoulders[1]), 0.08) }] : [];
  }) : [];
  // When no body is visible, retain travel relative to the first observed
  // wrist, rather than subtracting a different wrist in every frame. Absolute
  // body location is unavailable in this case; do not invent it.
  const fallback = normalization === "trajectory-v3" && !references.length
    ? { anchor: frames.flatMap(frame => frame.hands).find(validHand)?.landmarks[0] ?? { x: 0.5, y: 0.5, z: 0 }, bodyScale: 0.18 } : undefined;
  let referenceIndex = 0;
  const features = frames.map(frame => {
    // Both lists are chronological: one forward cursor avoids a quadratic
    // nearest-body search in every candidate window.
    while (referenceIndex + 1 < references.length && Math.abs(references[referenceIndex + 1].timestamp - frame.timestamp)
      < Math.abs(references[referenceIndex].timestamp - frame.timestamp)) referenceIndex++;
    return frameToFeatures(frame, references[referenceIndex] ?? fallback);
  });
  return resample(features, CALIBRATION_SEQUENCE_LENGTH, frames.map(frame => frame.timestamp));
}

export function calibrationFrames(frames: VisionFrame[]) {
  const recent = recentContinuousFrames(frames, 4200, frame => frame.hands.some(validHand));
  const visible = recent.filter(frame => frame.hands.some(validHand));
  if (visible.length < 8 || visible.length / recent.length < 0.7
    || visible.at(-1)!.timestamp - visible[0].timestamp < 700) return [];
  return visible;
}

export function recognizePersonalTemplate(
  frames: VisionFrame[],
  templates: CalibrationTemplate[],
) {
  return finishPersonalMatch(personalDistances(frames, templates));
}

export type MatchOptions = { signal?: AbortSignal; sliceMs?: number; onPhase?: (phase: "loading" | "matching") => void };

/** Same windows, distance cutoff and ambiguity veto as the synchronous matcher.
 * Run only in the dedicated matcher worker. Yielding lets reset/cancel messages
 * interrupt a scan; no work is silently skipped when a slice expires.
 */
export async function recognizePersonalTemplateAsync(
  frames: VisionFrame[], templates: CalibrationTemplate[], options: MatchOptions = {},
) {
  const matches = new Map<string, { template: CalibrationTemplate; distance: number }>();
  let yielded = performance.now();
  for (const [template, distance] of personalDistances(frames, templates)) {
    options.signal?.throwIfAborted();
    if (distance < (matches.get(template.gloss)?.distance ?? Infinity)) matches.set(template.gloss, { template, distance });
    if (performance.now() - yielded >= (options.sliceMs ?? 6)) {
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      options.signal?.throwIfAborted();
      yielded = performance.now();
    }
  }
  options.signal?.throwIfAborted();
  return finishPersonalMatch([...matches.values()].map(({ template, distance }) => [template, distance] as const));
}

// finishPersonalMatch accepts at most 0.5 and vetoes a rival within 0.06.
const ACCEPT_DISTANCE = 0.5;
const RIVAL_MARGIN = 0.06;
const MAX_RELEVANT_DISTANCE = ACCEPT_DISTANCE + RIVAL_MARGIN;
// Keeps float rounding at the bound from pruning a distance that matters.
const BOUND_TOLERANCE = 1e-9;

/** A distance at or above (best so far + margin) can neither become the best
 * nor veto it: the final best can only be lower. So the cutoff tightens as
 * matches are found. Every distance that can affect the decision is still
 * computed exactly; only irrelevant ones are reported as Infinity sooner.
 */
function* personalDistances(frames: VisionFrame[], templates: CalibrationTemplate[]) {
  if (!templates.length || frames.length < 8 || !frames.at(-1)?.hands.some(validHand)) return;
  let best = Infinity;
  let previousLength = 0;
  for (const duration of [650, 1200, 2000, 3000, 4200]) {
    const recent = recentContinuousFrames(frames, duration, frame => frame.hands.some(validHand));
    if (recent.length === previousLength) continue;
    previousLength = recent.length;
    if (recent.length < 8 || recent.filter(frame => frame.hands.some(validHand)).length / recent.length < 0.7) continue;
    const candidates = new Map<CalibrationTemplate["normalization"], DistanceSequence>();
    for (const template of templates) {
      if (template.frames.length !== CALIBRATION_SEQUENCE_LENGTH) continue;
      let candidate = candidates.get(template.normalization);
      if (!candidate) {
        candidate = compileDistanceSequence(prepareCalibrationSequence(recent, template.normalization));
        candidates.set(template.normalization, candidate);
      }
      const limit = Math.min(MAX_RELEVANT_DISTANCE, best + RIVAL_MARGIN + BOUND_TOLERANCE);
      const distance = compiledSequenceDistance(candidate, cachedTemplateSequence(template.frames), limit);
      if (distance < best) best = distance;
      yield [template, distance] as const;
    }
  }
}

function finishPersonalMatch(distances: Iterable<readonly [CalibrationTemplate, number]>) {
  const matches = new Map<string, { template: CalibrationTemplate; distance: number }>();
  for (const [template, distance] of distances) {
    if (Number.isFinite(distance) && distance < (matches.get(template.gloss)?.distance ?? Infinity)) {
      matches.set(template.gloss, { template, distance });
    }
  }
  const [best, rival] = [...matches.values()].sort((a, b) => a.distance - b.distance);
  if (!best || best.distance > ACCEPT_DISTANCE || (rival && rival.distance - best.distance < RIVAL_MARGIN)) return null;
  return { label: best.template.gloss, text: best.template.text,
    confidence: clamp(0.965 - best.distance * 0.24, 0, 0.96) };
}

// Only immutable template arrays are cached; live candidates are compiled once
// per window. Canonicalisation/validation is never repeated in the inner scan.
export type DistanceSequence = { rows: number[][]; length: number; valid: boolean };
const compiledTemplates = new WeakMap<number[][], DistanceSequence>();
export function cachedTemplateSequence(rows: number[][]) {
  let compiled = compiledTemplates.get(rows);
  if (!compiled) { compiled = compileDistanceSequence(rows); compiledTemplates.set(rows, compiled); }
  return compiled;
}
export function compileDistanceSequence(rows: number[][]): DistanceSequence {
  const canonical = rows.map(row => row.length === 208 ? [...row, ...new Array(32).fill(0)] : row);
  const length = canonical[0]?.length ?? 0;
  return { rows: canonical, length, valid: length > 0 && canonical.every(row =>
    row.length === length && row.every(Number.isFinite)) };
}

// Cache only immutable recorded-template envelopes, keyed by the existing
// frame-array identity. A global (unrestricted-warp) envelope is conservative:
 // every DTW path visits every query frame, and no frame can be cheaper than
// its minimum possible distance to the template feature ranges.
const distanceEnvelopes = new WeakMap<number[][], {
  min: Float64Array; max: Float64Array; alwaysPresent: boolean[];
}>();
const FEATURE_GROUPS = [[0, 66], [66, 132], [132, 173], [173, 240]] as const;

function envelopeLowerBound(query: number[][], template: number[][]) {
  let envelope = distanceEnvelopes.get(template);
  if (!envelope) {
    const min = new Float64Array(240).fill(Infinity);
    const max = new Float64Array(240).fill(-Infinity);
    const alwaysPresent = FEATURE_GROUPS.map(([start]) =>
      template.every(row => Boolean(row[start])));
    for (const row of template) {
      for (let k = 0; k < 240; k++) {
        if (row[k] < min[k]) min[k] = row[k];
        if (row[k] > max[k]) max[k] = row[k];
      }
    }
    envelope = { min, max, alwaysPresent };
    distanceEnvelopes.set(template, envelope);
  }

  let bound = 0;
  for (const row of query) {
    let minimumSquareSum = 0;
    FEATURE_GROUPS.forEach(([start, end], group) => {
      // MediaPipe hand features skip only when both hands are absent;
      // face/pose features skip when either side is absent.
      // An entire group is included only when every template frame
      // guarantees it is compared for this query row.
      if (!envelope!.alwaysPresent[group] || (group >= 2 && !row[start])) return;
      for (let k = start; k < end; k++) {
        const delta = Math.max(0, envelope!.min[k] - row[k], row[k] - envelope!.max[k]);
        minimumSquareSum += Math.min(delta * delta, 4);
      }
    });
    // Actual featureDistance divides by the *number of compared features*
    // (<=240), so using 240 gives a guaranteed underestimate.
    bound += Math.sqrt(minimumSquareSum / 240);
  }
  return bound / Math.max(query.length, template.length);
}

/**
 * Exact DTW with rolling rows and an optional upper bound. Every DTW path
 * passes through a cell in each row and costs are nonnegative, so a row whose
 * cheapest path already exceeds the bound can be abandoned safely.
 * Without a bound this returns the same distance as the original full matrix.
 */
export function sequenceDistance(a: number[][], b: number[][], maxDistance = Infinity) {
  return compiledSequenceDistance(compileDistanceSequence(a), compileDistanceSequence(b), maxDistance);
}

export function compiledSequenceDistance(query: DistanceSequence, template: DistanceSequence, maxDistance = Infinity) {
  if (!query.valid || !template.valid || query.length !== template.length) return Infinity;
  const a = query.rows, b = template.rows, length = query.length;
  const divisor = Math.max(a.length, b.length);
  // The envelope bound is always <= exact DTW; only prune when mathematically
  // unable to reach the acceptance/margin cutoff. Tolerance protects borders
  // from floating-point rounding.
  if (length === 240 && Number.isFinite(maxDistance)
    && envelopeLowerBound(a, b) > maxDistance + 1e-9) return Infinity;
  const cutoff = Number.isFinite(maxDistance) ? maxDistance * divisor : Infinity;
  let previous = new Float64Array(b.length + 1).fill(Infinity);
  let current = new Float64Array(b.length + 1).fill(Infinity);
  previous[0] = 0;

  for (let i = 1; i <= a.length; i++) {
    current[0] = Infinity;
    let minimumInRow = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = featureDistance(a[i - 1], b[j - 1]);
      const value = cost + Math.min(previous[j], current[j - 1], previous[j - 1]);
      current[j] = value;
      if (value < minimumInRow) minimumInRow = value;
    }
    if (minimumInRow > cutoff) return Infinity;
    [previous, current] = [current, previous];
  }
  return previous[b.length] / divisor;
}

function frameToFeatures(frame: VisionFrame, reference?: { anchor: Point; bodyScale: number }) {
  const shoulders = frame.pose.length > 12 ? [frame.pose[11], frame.pose[12]] : [];
  const wrists = frame.hands.map((hand) => hand.landmarks[0]).filter(Boolean);
  const anchor = reference?.anchor ?? (shoulders.length === 2
    ? midpoint(shoulders[0], shoulders[1])
    : averagePoint(wrists));
  const bodyScale = reference?.bodyScale ?? (shoulders.length === 2
    ? Math.max(distance(shoulders[0], shoulders[1]), 0.08)
    : Math.max(pointRange(wrists), 0.18));

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
  const values = points.slice(0, (empty.length - 1) / 2).flatMap((point) => [
    clamp((point.x - anchor.x) / scale, -4, 4),
    clamp((point.y - anchor.y) / scale, -4, 4),
  ]);
  while (values.length < empty.length - 1) values.push(0);
  return [1, ...values];
}

function featureDistance(a: number[], b: number[]) {
  const length = a.length;
  if (!length) return Number.POSITIVE_INFINITY;
  let total = 0;
  let compared = 0;
  // Decide missing-landmark masks once per group, not 240 times per cell.
  const groups: ReadonlyArray<readonly [number, number]> = length === 240 ? FEATURE_GROUPS : [[0, length]];
  for (const [start, end] of groups) {
    if (length === 240 && (start >= 132 ? (!a[start] || !b[start]) : (!a[start] && !b[start]))) continue;
    for (let index = start; index < end; index++) {
      const delta = a[index] - b[index];
      total += Math.min(delta * delta, 4);
    }
    compared += end - start;
  }
  return compared ? Math.sqrt(total / compared) : Infinity;
}

function resample(sequence: number[][], targetLength: number, times: number[]) {
  if (sequence.length === 1) return Array.from({ length: targetLength }, () => [...sequence[0]]);
  const duration = times.at(-1)! - times[0];
  if (!Number.isFinite(duration) || duration <= 0 || times.some((time, i) => !Number.isFinite(time) || (i > 0 && time <= times[i - 1]))) return [];
  let cursor = 0;
  return Array.from({ length: targetLength }, (_, index) => {
    const at = times[0] + index * duration / (targetLength - 1);
    while (cursor < times.length - 1 && Math.abs(times[cursor + 1] - at) <= Math.abs(times[cursor] - at)) cursor++;
    // Nearest observation preserves missing-hand masks and orientation. No
    // invented landmarks across occlusion; DTW still handles signing speed.
    return [...sequence[cursor]];
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
