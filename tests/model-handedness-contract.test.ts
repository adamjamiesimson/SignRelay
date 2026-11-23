import { describe, expect, it } from "vitest";
import { prepareTgcnInput } from "../lib/asl1000-runtime";
import { prepareBslInput } from "../lib/bsl1064-runtime";
import type { HandObservation, VisionFrame } from "../lib/vision-types";

function sample(side: "Left" | "Right", x = 0.75): VisionFrame {
  const hand: HandObservation = {
    handedness: side, gesture: "None", gestureScore: 0,
    landmarks: Array.from({ length: 21 }, (_, k) => ({
      x: x + k / 1000, y: 0.45 + k / 1000, z: 0,
    })),
  };
  return {
    timestamp: 1000,
    hands: [hand],
    face: [],
    pose: Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 })),
  };
}

describe("pose model hand-slot mapping (input contract, not camera handedness accuracy)", () => {
  it.each(["Left", "Right"] as const)("places %s landmarks into the intended ASL OpenPose hand slot", side => {
    const encoded = prepareTgcnInput([sample(side)], 1);
    const firstLeft = 13 * 2;
    const firstRight = (13 + 21) * 2;
    const active = 2 * (0.75 - 0.5);
    const present = side === "Left" ? firstLeft : firstRight;
    const absent = side === "Left" ? firstRight : firstLeft;
    expect(encoded[present]).toBeCloseTo(active);
    expect(encoded[absent]).toBe(-1);
  });

  it.each(["Left", "Right"] as const)("places %s landmarks into the intended BSL OpenPose hand slot", side => {
    const frames = Array.from({ length: 16 }, (_, i) => ({ ...sample(side), timestamp: i * 50 }));
    const encoded = prepareBslInput(frames);
    const firstLeft = 18;
    const firstRight = 18 + 21;
    const present = side === "Left" ? firstLeft : firstRight;
    const absent = side === "Left" ? firstRight : firstLeft;
    expect(encoded[present]).toBeCloseTo(0.75);
    expect(encoded[absent]).toBe(0);
  });
});
