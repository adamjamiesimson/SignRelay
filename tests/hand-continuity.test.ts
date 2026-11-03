import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_CONTINUITY, HAND_CONTINUITY_GUARD_ENABLED, findHandDiscontinuities, palmLength, selectedHand } from "../lib/hand-continuity";
import type { HandObservation } from "../lib/vision-types";

// A synthetic hand: wrist at (x, y), palm length `palm` (height units), upright.
const hand = (x: number, y: number, palm = 0.1, handedness: "Left" | "Right" = "Right"): HandObservation => ({
  handedness, gesture: "None", gestureScore: 0,
  landmarks: Array.from({ length: 21 }, (_, j) => ({ x, y: y - (j === 9 ? palm : j * palm / 40), z: 0 })),
});
const at = (time: number, ...hands: HandObservation[]) => ({ time, hands });

describe("hand continuity", () => {
  it("is detection-only: the guard is off in production and capture does not call it", () => {
    expect(HAND_CONTINUITY_GUARD_ENABLED).toBe(false);
    expect(readFileSync("lib/fingerspelling-capture.ts", "utf8")).not.toMatch(/hand-continuity/);
  });
  it("selects exactly as capture does: the first valid hand carrying the side label", () => {
    const a = hand(0.3, 0.5), b = hand(0.7, 0.5);
    expect(selectedHand([a, b], "Right")).toBe(a);
    expect(selectedHand([hand(0.2, 0.5, 0.1, "Left"), b], "Right")).toBe(b);
    expect(selectedHand([{ ...a, landmarks: a.landmarks.slice(0, 20) }, b], "Right")).toBe(b);
  });
  it("measures palm length in height units", () => {
    expect(palmLength(hand(0.5, 0.5, 0.1), 16 / 9)).toBeCloseTo(0.1, 6);
  });
  it("accepts steady fingerspelling motion", () => {
    const seq = Array.from({ length: 30 }, (_, t) => at(t * 66, hand(0.4 + 0.004 * t, 0.5 + 0.002 * Math.sin(t))));
    expect(findHandDiscontinuities(seq, "Right", 4 / 3)).toEqual([]);
  });
  it("flags another person's same-label hand taking over", () => {
    const seq = [at(0, hand(0.3, 0.5)), at(66, hand(0.3, 0.5)), at(133, hand(0.8, 0.45)), at(200, hand(0.8, 0.45))];
    const found = findHandDiscontinuities(seq, "Right", 2);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ index: 2, reason: "jump" });
    expect(found[0].wristJumpPalms).toBeGreaterThan(DEFAULT_CONTINUITY.maxWristJumpPalms);
  });
  it("flags a sudden apparent-size change at the same place (a nearer or farther person)", () => {
    const seq = [at(0, hand(0.5, 0.5, 0.1)), at(66, hand(0.5, 0.5, 0.2))];
    expect(findHandDiscontinuities(seq, "Right", 1)).toMatchObject([{ index: 1, reason: "scale" }]);
  });
  it("does not treat a long gap as a jump and ignores the other side's hands", () => {
    const seq = [at(0, hand(0.3, 0.5)), at(500, hand(0.8, 0.5)), at(566, hand(0.8, 0.5), hand(0.1, 0.5, 0.1, "Left"))];
    expect(findHandDiscontinuities(seq, "Right", 1)).toEqual([]);
  });
});
