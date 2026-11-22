import type { HandObservation, VisionFrame } from "./vision-types";
import { bodyReference, distance2, handScale, validHand } from "./asl-starter-recognition";
import { recentContinuousFrames } from "./frame-timing";

export type SignMotion = { ready: boolean; sequence: VisionFrame[]; reason: "hands" | "moving" | "idle" | "ready";
  completion?: "rest" | "departure" };

/** A hand that leaves the view ends a movement too. Wait this long first, so
 * one frame the tracker missed is not read as leaving... */
export const DEPARTURE_MIN_ABSENT_MS = 250;
/** Keep the completed movement available for a slow model run. */
const COMPLETED_AVAILABLE_MS = 2500;

const reject = (reason: SignMotion["reason"]): SignMotion => ({ ready: false, sequence: [], reason });

/** Find the latest movement while a hand was visible. In the rest case, the
 * hand must have settled. A departure can end at the last observation. */
function scan(frames: VisionFrame[], completion: "rest" | "departure"): SignMotion {
  const end = frames.at(-1)!;
  let moving = false;
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
    if (!excursion) continue;

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
    if (startIndex < 0) continue;
    const segment = recent.slice(startIndex);
    const settledFor = end.timestamp - lastActive;
    if (completion === "rest" && settledFor < 140) { moving = true; continue; }
    if (settledFor > COMPLETED_AVAILABLE_MS || segment.length < 6 || end.timestamp - segment[0].timestamp < 220) continue;
    return { ready: true, sequence: segment, reason: "ready", completion };
  }
  return reject(completion === "departure" ? "hands" : moving ? "moving" : "idle");
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
  if (!end) return reject("hands");
  if (!end.hands.some(validHand)) {
    let last = frames.length - 1;
    while (last >= 0 && !frames[last].hands.some(validHand)) last--;
    if (last < 0) return reject("hands");
    const absentFor = end.timestamp - frames[last].timestamp;
    // Timestamps must run forward; a reset clock is not a departure.
    if (!(absentFor >= DEPARTURE_MIN_ABSENT_MS) || absentFor > COMPLETED_AVAILABLE_MS
      || frames.length - last - 1 < 2) return reject("hands");
    return scan(frames.slice(0, last + 1), "departure");
  }
  return scan(frames, "rest");
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
