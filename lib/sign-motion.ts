import type { HandObservation, VisionFrame } from "./vision-types";
import { bodyReference, distance2, handScale, validHand } from "./asl-starter-recognition";
import { recentContinuousFrames } from "./frame-timing";

/** Why the gate answered as it did: a code, never landmarks. `completion` says
 * how a ready movement ended. */
export type SignMotionDetail = "no-hand" | "departed-too-recently" | "departed-too-long-ago" | "too-few-observations"
  | "no-movement" | "still-moving" | "rested-too-long" | "too-short" | "rest" | "departure";
export type SignMotion = { ready: boolean; sequence: VisionFrame[]; reason: "hands" | "moving" | "idle" | "ready";
  detail: SignMotionDetail; completion?: "rest" | "departure" };

/** A hand that leaves the view ends a movement too. Wait this long first, so
 * one frame the tracker missed is not read as leaving... */
export const DEPARTURE_MIN_ABSENT_MS = 250;
/** ...and keep the completed movement available as long as a movement that
 * ended in a visible rest, so two model results can arrive on a slow CPU. */
const COMPLETED_AVAILABLE_MS = 2500;

type Scan = { sequence: VisionFrame[] | null; detail: SignMotionDetail; moving: boolean };

/** Find the latest movement in frames whose last frame shows a hand.
 * `needsRest`: the hand must have settled in view (the live, still-visible
 * case). Without it the movement may run up to the last observation, which is
 * only allowed once the hand is known to have left. */
function scan(frames: VisionFrame[], needsRest: boolean): Scan {
  const end = frames.at(-1)!;
  let moving = false;
  // The most informative reason any hand side reached, for diagnostics.
  let detail: SignMotionDetail = "too-few-observations";
  for (const side of ["Left", "Right", "Unknown"] as const) {
    const recent = recentContinuousFrames(frames, 3600,
      frame => frame.hands.some(hand => hand.handedness === side && validHand(hand)));
    const samples = recent.flatMap((frame, index) => {
      const hand = frame.hands.find(hand => hand.handedness === side && validHand(hand));
      return hand ? [{ frame, hand, index }] : [];
    });
    if (samples.length < 6 || samples.length / recent.length < 0.65
      || samples.at(-1)?.frame.timestamp !== end.timestamp) continue;
    // A common body reference avoids a spurious motion jump when pose briefly disappears.
    const tracked = samples.map(sample => bodyReference(sample.frame, sample.hand)).filter(ref => ref.tracked);
    const scale = tracked.length ? tracked[Math.floor(tracked.length / 2)].scale : handScale(samples[0].hand) * 4;
    const first = samples[0];
    const travel = (a: HandObservation, b: HandObservation) => distance2(a.landmarks[0], b.landmarks[0]) / scale;
    const excursion = samples.some(sample => travel(first.hand, sample.hand) > 0.18 || shapeDistance(first.hand, sample.hand) > 0.5);
    if (!excursion) { detail = "no-movement"; continue; }

    let startIndex = -1;
    let lastActive = 0;
    for (let index = 1; index < samples.length; index++) {
      const current = samples[index];
      // Compare over at least 100 ms so the gate does not depend on capture frame rate.
      let before = first;
      for (let previous = index - 1; previous >= 0; previous--) {
        if (current.frame.timestamp - samples[previous].frame.timestamp >= 100) {
          before = samples[previous];
          break;
        }
      }
      if (travel(before.hand, current.hand) > 0.035 || shapeDistance(before.hand, current.hand) > 0.14) {
        if (startIndex < 0) startIndex = Math.max(0, before.index - 1);
        const previous = samples[index - 1];
        if (travel(previous.hand, current.hand) > 0.01 || shapeDistance(previous.hand, current.hand) > 0.05) {
          lastActive = current.frame.timestamp;
        }
      }
    }
    if (startIndex < 0) { detail = "no-movement"; continue; }
    const segment = recent.slice(startIndex);
    const settledFor = end.timestamp - lastActive;
    if (needsRest && settledFor < 140) { moving = true; detail = "still-moving"; continue; }
    // Two real CPU predictions can take longer than one second. Keep a recent
    // completed movement available while rejecting new motion and absent hands.
    if (settledFor > COMPLETED_AVAILABLE_MS) { detail = "rested-too-long"; continue; }
    if (segment.length < 6 || end.timestamp - segment[0].timestamp < 220) { detail = "too-short"; continue; }
    return { sequence: segment, detail: needsRest ? "rest" : "departure", moving };
  }
  return { sequence: null, detail, moving };
}

/** Segment an isolated ASL sign using both hand travel and finger articulation.
 * A movement is complete when the hand rests in view, or when it has left the
 * view: signers often drop the hand straight after a sign, and until this was
 * handled the research model never received a segment on any of the eleven
 * development clips. Leaving is not enough by itself: the frames before it
 * must pass the same movement, length and continuity checks as a rested
 * movement, and only observed frames are ever returned. */
export function analyzeSignMotion(frames: VisionFrame[]): SignMotion {
  const end = frames.at(-1);
  const reject = (reason: SignMotion["reason"], detail: SignMotionDetail): SignMotion => ({ ready: false, sequence: [], reason, detail });
  if (!end) return reject("hands", "no-hand");
  if (!end.hands.some(validHand)) {
    let last = frames.length - 1;
    while (last >= 0 && !frames[last].hands.some(validHand)) last--;
    if (last < 0) return reject("hands", "no-hand");
    const absentFor = end.timestamp - frames[last].timestamp;
    // Timestamps must run forward; a reset clock is not a departure.
    if (!(absentFor >= DEPARTURE_MIN_ABSENT_MS)) return reject("hands", "departed-too-recently");
    if (absentFor > COMPLETED_AVAILABLE_MS) return reject("hands", "departed-too-long-ago");
    const result = scan(frames.slice(0, last + 1), false);
    if (!result.sequence) return reject("hands", result.detail);
    return { ready: true, sequence: result.sequence, reason: "ready", detail: "departure", completion: "departure" };
  }
  const result = scan(frames, true);
  if (result.sequence) return { ready: true, sequence: result.sequence, reason: "ready", detail: "rest", completion: "rest" };
  return reject(result.moving ? "moving" : "idle", result.detail);
}

function shapeDistance(a: HandObservation, b: HandObservation) {
  const scales = [handScale(a), handScale(b)];
  return Math.max(...[4, 8, 12, 16, 20].map(index => {
    const ax = (a.landmarks[index].x - a.landmarks[0].x) / scales[0];
    const ay = (a.landmarks[index].y - a.landmarks[0].y) / scales[0];
    const bx = (b.landmarks[index].x - b.landmarks[0].x) / scales[1];
    const by = (b.landmarks[index].y - b.landmarks[0].y) / scales[1];
    return Math.hypot(ax - bx, ay - by);
  }));
}
