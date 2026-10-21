import type { HandObservation, VisionFrame } from "./vision-types";
import { distance2, handScale, validHand } from "./asl-starter-recognition";

/** MediaPipe classifies handedness independently in every frame. On one
 * moving hand the label can change mid-movement, which would split one
 * physical hand into two partial tracks. This keeps the label of a single,
 * spatially continuous hand; it never swaps labels, never edits two-hand
 * frames and never links a hand that reappears elsewhere or after a gap.
 */
export type SingleHandTrack = { timestamp: number; hand: HandObservation } | null;

export const TRACK_GAP_MS = 300;

function center(hand: HandObservation) {
  return [0, 5, 9, 13, 17].reduce((sum, index) => ({
    x: sum.x + hand.landmarks[index].x / 5, y: sum.y + hand.landmarks[index].y / 5, z: 0,
  }), { x: 0, y: 0, z: 0 });
}

export function sameHand(previous: HandObservation, current: HandObservation) {
  const limit = Math.max(0.12, 2 * Math.max(handScale(previous), handScale(current)));
  return distance2(center(previous), center(current)) <= limit;
}

export function stabilizeHandedness(track: SingleHandTrack, frame: VisionFrame): { frame: VisionFrame; track: SingleHandTrack } {
  const hands = frame.hands.filter(validHand);
  if (hands.length !== 1) return { frame, track: null };
  const [hand] = hands;
  const continuous = track && frame.timestamp > track.timestamp && frame.timestamp - track.timestamp <= TRACK_GAP_MS
    && sameHand(track.hand, hand);
  if (!continuous || track.hand.handedness === hand.handedness) return { frame, track: { timestamp: frame.timestamp, hand } };
  const relabelled = { ...hand, handedness: track.hand.handedness };
  return {
    frame: { ...frame, hands: frame.hands.map(item => item === hand ? relabelled : item) },
    track: { timestamp: frame.timestamp, hand: relabelled },
  };
}
