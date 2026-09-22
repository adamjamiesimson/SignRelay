import { describe, expect, it } from "vitest";
import { bdslClipHasMotion, bdslTemporalIndices, decodeBdslOutput, packBdslFrames, resizeBdslFrame } from "../lib/bdsl-video";

const frame = (red: number) => ({ width: 2, height: 2, rgba: new Uint8ClampedArray([red, 0, 0, 255, red, 0, 0, 255, red, 0, 0, 255, red, 0, 0, 255]) });
const labels = Array.from({ length: 401 }, (_, index) => `word ${index + 1}`);

describe("Bangla video input and rejection", () => {
  it("uses the publisher's truncation and repetition for short clips", () => {
    expect(bdslTemporalIndices(3)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 2]);
    expect(() => bdslTemporalIndices(0)).toThrow();
    expect(() => bdslTemporalIndices(181)).toThrow();
  });
  it("preserves RGB order and full-frame edges without cropping", () => {
    const packed = resizeBdslFrame(frame(255));
    expect(packed).toHaveLength(3 * 224 * 224);
    expect(packed[0]).toBeCloseTo((1 - 0.485) / 0.229, 5);
    expect(packed[224 * 224]).toBeCloseTo(-0.456 / 0.224, 5);
    const wide = { width: 640, height: 1, rgba: new Uint8ClampedArray(640 * 4) };
    wide.rgba.fill(255, 0, 100 * 4);
    const resized = resizeBdslFrame(wide);
    expect(resized[0]).toBeGreaterThan(2);
    expect(resized[223]).toBeLessThan(-2);
  });
  it("packs time before RGB and rejects incomplete or changing camera frames", () => {
    const packed = packBdslFrames([frame(0), frame(255)]);
    expect(packed).toHaveLength(16 * 3 * 224 * 224);
    expect(packed[0]).toBeLessThan(0);
    expect(packed[15 * 3 * 224 * 224]).toBeGreaterThan(2);
    expect(() => packBdslFrames([{ ...frame(0), width: 3 }])).toThrow();
    expect(() => packBdslFrames([frame(0), { width: 1, height: 1, rgba: new Uint8ClampedArray(4) }])).toThrow("dimensions changed");
  });
  it("does not treat a static scene as a sign", () => {
    expect(bdslClipHasMotion([frame(20), frame(20)])).toBe(false);
    expect(bdslClipHasMotion([frame(0), frame(255)])).toBe(true);
  });
  it("rejects weak, competing and nonfinite scores", () => {
    expect(decodeBdslOutput(new Float32Array(401), labels)).toBeNull();
    const tied = new Float32Array(401); tied[0] = tied[1] = 20;
    expect(decodeBdslOutput(tied, labels)).toBeNull();
    tied[0] = NaN;
    expect(() => decodeBdslOutput(tied, labels)).toThrow();
  });
  it("keeps class identity when source English glosses repeat", () => {
    const repeated = [...labels]; repeated[1] = repeated[0];
    const logits = new Float32Array(401); logits[1] = 20;
    expect(decodeBdslOutput(logits, repeated)).toMatchObject({ code: "W002", label: repeated[1] });
  });
});
