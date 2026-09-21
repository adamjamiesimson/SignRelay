// Regression coverage for a bug found while auditing the shared-model
// recognizers: prepareIncludeInput counted "visible" frames from the
// landmark array *after* interpolateCoordinate had already back-filled every
// zero coordinate in place. With even a single real tracked point anywhere
// in the 200-frame window, that pass makes nearly every frame look visible,
// defeating the MIN_VISIBLE_FRAMES reject gate entirely.
import { describe, expect, it } from "vitest";
import { prepareIncludeInput } from "../lib/isl263-runtime";
import type { VisionFrame } from "../lib/vision-types";

function emptyFrame(timestamp: number): VisionFrame {
  return { timestamp, hands: [], face: [], pose: [] };
}

describe("prepareIncludeInput", () => {
  it("counts visibility from real tracking, not from interpolation's later backfill", () => {
    const frames: VisionFrame[] = Array.from({ length: 20 }, (_, index) => emptyFrame(index * 33));
    // Exactly one frame has a single real tracked point; every other frame is
    // fully untracked (empty pose/hands).
    frames[10] = { ...frames[10], pose: [{ x: 0.5, y: 0.5, z: 0 }] };
    const prepared = prepareIncludeInput(frames);
    expect(prepared.visibleFrames).toBe(1);
  });

  it("still reports every frame visible when every frame is genuinely tracked", () => {
    const frames: VisionFrame[] = Array.from({ length: 20 }, (_, index) => ({
      timestamp: index * 33, hands: [], face: [], pose: [{ x: 0.5, y: 0.5, z: 0 }],
    }));
    expect(prepareIncludeInput(frames).visibleFrames).toBe(20);
  });
});
