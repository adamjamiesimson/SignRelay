import type { HandObservation, VisionFrame } from "./vision-types";
import { bodyReference, distance2, handScale, validHand } from "./asl-starter-recognition";

export type SignMotion = { ready: boolean; sequence: VisionFrame[]; reason: "hands" | "moving" | "idle" | "ready" };

/** Segment an isolated ASL sign using both hand travel and finger articulation. */
export function analyzeSignMotion(frames: VisionFrame[]): SignMotion {
  const end = frames.at(-1);
  const reject = (reason: SignMotion["reason"]): SignMotion => ({ ready: false, sequence: [], reason });
  if (!end?.hands.some(validHand)) return reject("hands");
  const recent = frames.filter(frame => end.timestamp - frame.timestamp <= 3600);
  if (recent.length < 6) return reject("idle");
  if (recent.some((frame, index) => index > 0 && (frame.timestamp <= recent[index - 1].timestamp
    || frame.timestamp - recent[index - 1].timestamp > 250))) return reject("hands");

  let moving = false;
  for (const side of ["Left", "Right", "Unknown"] as const) {
    const samples = recent.flatMap((frame, index) => {
      const hand = frame.hands.find(hand => hand.handedness === side && validHand(hand));
      return hand ? [{ frame, hand, index }] : [];
    });
    if (samples.length < 6 || samples.length / recent.length < 0.65
      || samples.at(-1)?.frame.timestamp !== end.timestamp) continue;
    if (samples.some((sample, index) => index > 0
      && sample.frame.timestamp - samples[index - 1].frame.timestamp > 240)) continue;
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
      const before = samples.slice(0, index).findLast(sample => current.frame.timestamp - sample.frame.timestamp >= 100) ?? first;
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
    if (settledFor < 140) { moving = true; continue; }
    if (settledFor > 1000 || segment.length < 6 || end.timestamp - segment[0].timestamp < 220) continue;
    return { ready: true, sequence: segment, reason: "ready" };
  }
  return reject(moving ? "moving" : "idle");
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
