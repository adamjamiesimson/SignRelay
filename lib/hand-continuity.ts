import type { HandObservation } from "./vision-types";

/**
 * Hand-identity continuity for one-hand fingerspelling capture.
 *
 * FingerspellingCapture picks, per frame, the first hand carrying the
 * dominant handedness label. If a second person's hand with the same label
 * becomes the first match, the sequence silently switches hands. This module
 * finds such discontinuities: a frame-to-frame wrist jump, measured in the
 * signer's own palm lengths (camera-distance invariant), or a sudden change
 * of apparent palm size.
 *
 * Detection only. Whether a detected discontinuity rejects a capture is a
 * recognition-policy decision and is OFF in production
 * (HAND_CONTINUITY_GUARD_ENABLED) until recorded evidence sets the threshold
 * (scripts/diagnostics/two-hand-rgb.ts measures both false and true
 * detections on licensed frames).
 */
export const HAND_CONTINUITY_GUARD_ENABLED = false;

export type ContinuityOptions = {
  /** Wrist displacement between consecutive selected frames, in palm lengths. */
  maxWristJumpPalms: number;
  /** Largest allowed ratio between consecutive apparent palm lengths. */
  maxPalmScaleRatio: number;
  /** Frames further apart than this are a gap, not a jump (capture rejects long gaps itself). */
  maxGapMs: number;
};
export const DEFAULT_CONTINUITY: ContinuityOptions = { maxWristJumpPalms: 3, maxPalmScaleRatio: 1.6, maxGapMs: 200 };

type Sample = { time: number; hands: HandObservation[] };
export type Discontinuity = { index: number; wristJumpPalms: number; palmScaleRatio: number; reason: "jump" | "scale" };

const valid = (h: HandObservation) => h.landmarks.length === 21 && h.landmarks.every(p => [p.x, p.y, p.z].every(Number.isFinite));

/** The hand capture would use for `side` in this frame (same rule as FingerspellingCapture). */
export function selectedHand(hands: HandObservation[], side: "Left" | "Right") {
  return hands.find(h => h.handedness === side && valid(h));
}

/** Palm length: wrist to middle-finger MCP, in height units (x scaled by aspect). */
export function palmLength(hand: HandObservation, aspect: number) {
  const [w, m] = [hand.landmarks[0], hand.landmarks[9]];
  return Math.hypot((m.x - w.x) * aspect, m.y - w.y);
}

export function findHandDiscontinuities(samples: Sample[], side: "Left" | "Right", aspect: number, options: ContinuityOptions = DEFAULT_CONTINUITY): Discontinuity[] {
  const found: Discontinuity[] = [];
  let previous: { hand: HandObservation; time: number } | null = null;
  samples.forEach((sample, index) => {
    const hand = selectedHand(sample.hands, side);
    if (!hand) return;
    if (previous && sample.time - previous.time <= options.maxGapMs) {
      const a = previous.hand.landmarks[0], b = hand.landmarks[0];
      const palmA = palmLength(previous.hand, aspect), palmB = palmLength(hand, aspect);
      const palm = Math.max(1e-6, Math.min(palmA, palmB));
      const wristJumpPalms = Math.hypot((b.x - a.x) * aspect, b.y - a.y) / palm;
      const palmScaleRatio = Math.max(palmA, palmB) / palm;
      if (wristJumpPalms > options.maxWristJumpPalms) found.push({ index, wristJumpPalms, palmScaleRatio, reason: "jump" });
      else if (palmScaleRatio > options.maxPalmScaleRatio) found.push({ index, wristJumpPalms, palmScaleRatio, reason: "scale" });
    }
    previous = { hand, time: sample.time };
  });
  return found;
}
