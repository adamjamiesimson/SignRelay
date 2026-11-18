import { bodyReference, handScale, validHand } from "./asl-starter-recognition";
import type { HandObservation, Point, VisionFrame } from "./vision-types";

export const ASL_TEMPORAL_FEATURES = "asl-temporal-v1";
const BINS = 12;
const HAND_POINTS = [4, 5, 8, 9, 12, 13, 16, 17, 20];
// Hand, body, face and second-hand masks followed by local hand geometry,
// body-relative wrist, mouth-relative fingertips, and inter-wrist distance.
const FRAME_WIDTH = 4 + HAND_POINTS.length * 3 + 6;
export const ASL_TEMPORAL_WIDTH = BINS * FRAME_WIDTH;
const MAX_HAND_GAP_MS = 210;
const finite = (point: Point | undefined): point is Point => !!point && Number.isFinite(point.x) && Number.isFinite(point.y);
const visible = (point: Point | undefined): point is Point => finite(point) && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1;
const bounded = (value: number) => Math.max(-4, Math.min(4, value));

type Observation = { frame: VisionFrame; hand: HandObservation };

function observations(frames: readonly VisionFrame[]) {
  const tracks: Observation[][] = [];
  for (const side of ["Left", "Right", "Unknown"] as const) {
    let track: Observation[] = [];
    for (const frame of frames) {
      const hand = frame.hands.find(hand => hand.handedness === side && validHand(hand) && visible(hand.landmarks[0]));
      if (!hand) continue;
      const previous = track.at(-1);
      if (previous && frame.timestamp - previous.frame.timestamp > MAX_HAND_GAP_MS) {
        tracks.push(track);
        track = [];
      }
      track.push({ frame, hand });
    }
    tracks.push(track);
  }
  return tracks.filter(track => track.length >= 5 && track.at(-1)!.frame.timestamp - track[0].frame.timestamp >= 180);
}

function activity(track: Observation[]) {
  let energy = 0;
  for (let i = 1; i < track.length; i++) {
    const before = track[i - 1].hand.landmarks;
    const after = track[i].hand.landmarks;
    const scale = handScale(track[i].hand);
    energy += [0, 4, 8, 20].reduce((sum, point) => sum + Math.min(1,
      Math.hypot(before[point].x - after[point].x, before[point].y - after[point].y) / scale), 0);
  }
  return energy;
}

function vector({ frame, hand }: Observation) {
  const [wrist] = hand.landmarks;
  const flip = hand.handedness === "Left" ? -1 : 1;
  const scale = handScale(hand);
  const body = bodyReference(frame, hand);
  // Face lip landmarks 13/14 occupy slots 3/4 in the production wire format.
  const [upperLip, lowerLip] = [frame.face[3], frame.face[4]];
  const hasFace = visible(upperLip) && visible(lowerLip);
  const tip = hand.landmarks[12];
  const other = frame.hands.find(candidate => candidate !== hand && validHand(candidate) && visible(candidate.landmarks[0]));
  const hasOther = !!other;
  return [1, Number(body.tracked), Number(hasFace), Number(hasOther),
    ...HAND_POINTS.flatMap(index => {
      const point = hand.landmarks[index];
      return [(point.x - wrist.x) / scale * flip, (point.y - wrist.y) / scale, (point.z - wrist.z) / scale];
    }),
    body.tracked ? (wrist.x - body.anchor.x) / body.scale * flip : 0,
    body.tracked ? (wrist.y - body.anchor.y) / body.scale : 0,
    hasFace ? (tip.x - (upperLip.x + lowerLip.x) / 2) / scale * flip : 0,
    hasFace ? (tip.y - (upperLip.y + lowerLip.y) / 2) / scale : 0,
    other ? (other.landmarks[0].x - wrist.x) / scale * flip : 0,
    other ? (other.landmarks[0].y - wrist.y) / scale : 0,
  ].map(bounded);
}

/** One externally bounded isolated-sign clip or proposed live segment. Samples
 * are binned by measured time and never interpolated across hand loss. */
export function describeAslTemporal(frames: readonly VisionFrame[]) {
  if (frames.some((frame, i) => !Number.isFinite(frame.timestamp) || (i > 0 && frame.timestamp <= frames[i - 1].timestamp))) return null;
  const ranked = observations(frames).map(track => ({ track, energy: activity(track) }))
    .sort((a, b) => b.energy - a.energy);
  const best = ranked[0];
  if (!best || best.energy < 0.8) return null;
  const { track } = best;
  const first = track[0].frame.timestamp;
  const duration = track.at(-1)!.frame.timestamp - first;
  const sums = Array.from({ length: BINS }, () => Array<number>(FRAME_WIDTH).fill(0));
  const counts = Array<number>(BINS).fill(0);
  for (const sample of track) {
    const bin = Math.min(BINS - 1, Math.floor((sample.frame.timestamp - first) / duration * BINS));
    vector(sample).forEach((value, i) => { sums[bin][i] += value; });
    counts[bin]++;
  }
  return {
    features: sums.flatMap((values, i) => counts[i] ? values.map(value => value / counts[i]) : values),
    observedFrames: track.length,
    observedBins: counts.filter(Boolean).length,
    duration,
  };
}
