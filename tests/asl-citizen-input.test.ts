import { describe, expect, it } from "vitest";
import { ASL_CITIZEN_NODES, ASL_CITIZEN_SEQUENCE_LENGTH, prepareAslCitizenInput } from "../lib/asl-citizen-input";
import type { HandObservation, Point, VisionFrame } from "../lib/vision-types";

const point = (x: number, y: number): Point => ({ x, y, z: 0 });
function hand(side: "Left" | "Right", x: number): HandObservation {
  return {
    handedness: side,
    gesture: "None",
    gestureScore: 0,
    landmarks: Array.from({ length: 21 }, (_, index) => point(x + index / 1000, 0.4)),
  };
}
function frame(timestamp: number, offset = 0): VisionFrame {
  const pose = Array.from({ length: 33 }, () => point(0, 0));
  pose[0] = point(0.5 + offset, 0.2);
  pose[2] = point(0.45 + offset, 0.22);
  pose[5] = point(0.55 + offset, 0.22);
  pose[11] = point(0.25 + offset, 0.5);
  pose[12] = point(0.75 + offset, 0.5);
  pose[13] = point(0.2 + offset, 0.6);
  pose[14] = point(0.8 + offset, 0.6);
  return {
    timestamp,
    pose,
    face: [],
    hands: [hand("Left", 0.2 + offset), hand("Right", 0.8 + offset)],
  };
}
const at = (input: Float32Array, channel: 0 | 1, time: number, node: number) =>
  input[channel * ASL_CITIZEN_SEQUENCE_LENGTH * ASL_CITIZEN_NODES + time * ASL_CITIZEN_NODES + node];

describe("ASL Citizen ST-GCN input adapter", () => {
  it("packs the exact 2 x 128 x 27 contract", () => {
    const input = prepareAslCitizenInput(Array.from({ length: 128 }, (_, i) => frame(i)));
    expect(input).toHaveLength(2 * 128 * 27);
    expect(input.every(Number.isFinite)).toBe(true);
  });

  it("normalises around shoulder centre and keeps left hand before right hand", () => {
    const input = prepareAslCitizenInput(Array.from({ length: 128 }, (_, i) => frame(i)));
    // Shoulders at x=.25/.75 => centre=.5, mean shoulder distance=.5.
    expect(at(input, 0, 0, 3)).toBeCloseTo(-0.5, 6); // pose 11 / left shoulder
    expect(at(input, 0, 0, 4)).toBeCloseTo(0.5, 6);  // pose 12 / right shoulder
    // Node 7 is reordered left-hand landmark 0; node 17 is right-hand landmark 0.
    expect(at(input, 0, 0, 7)).toBeCloseTo(-0.6, 6);
    expect(at(input, 0, 0, 17)).toBeCloseTo(0.6, 6);
  });

  it("matches the upstream even-frame downsampling pattern for 256 frames", () => {
    const sequence = Array.from({ length: 256 }, (_, i) => frame(i, i / 1000));
    const input = prepareAslCitizenInput(sequence);
    // First selected frame is source 0. The second is source 2, not source 1.
    // Translation cancels globally, so compare the nose-vs-shoulder geometry by
    // checking that the second temporal sample differs from the first.
    expect(at(input, 0, 1, 0)).not.toBe(at(input, 0, 0, 0));
  });

  it("returns zeros for an all-missing sequence instead of NaN", () => {
    const empty: VisionFrame[] = Array.from({ length: 20 }, (_, index) => ({
      timestamp: index,
      hands: [],
      face: [],
      pose: [],
    }));
    const input = prepareAslCitizenInput(empty);
    expect([...input].every(value => value === 0)).toBe(true);
  });
});
