import { describe, expect, it } from "vitest";
import { RSL_LABELS, RSL_FRAME_BYTES, decodeRslOutput, packRslFrames, rslClipHasMotion, rslLetterbox } from "../lib/rsl-video";
import { MODEL_ADAPTERS } from "../lib/model-adapters";

describe("pretrained RSL contract", () => {
  it("has 967 distinct words/phrases plus 33 letters, excluding background", () => {
    expect(RSL_LABELS).toHaveLength(1000);
    expect(new Set(RSL_LABELS.slice(33).map(label => label.toLowerCase())).size).toBe(967);
    expect(RSL_LABELS).not.toContain("---");
    expect(MODEL_ADAPTERS.rsl.automaticVocabularyCount).toBe(1000);
    expect(MODEL_ADAPTERS.rsl.status).toBe("experimental");
  });
  it("letterboxes landscape and portrait input without a crop or mirror", () => {
    expect(rslLetterbox(640, 480)).toEqual({ width: 224, height: 168, x: 0, y: 28 });
    expect(rslLetterbox(480, 640)).toEqual({ width: 168, height: 224, x: 28, y: 0 });
    expect(() => rslLetterbox(0, 100)).toThrow();
  });
  it("packs RGB in channel/time/pixel order using upstream normalization", () => {
    const frames = Array.from({ length: 32 }, () => new Uint8ClampedArray(RSL_FRAME_BYTES).fill(114));
    frames[1][0] = 200;
    const values = packRslFrames(frames);
    expect(values).toHaveLength(3 * 32 * 224 * 224);
    expect(values[0]).toBeCloseTo((114 - 123.675) / 58.395);
    expect(values[224 * 224]).toBeCloseTo((200 - 123.675) / 58.395);
    expect(values[32 * 224 * 224]).toBeCloseTo((114 - 116.28) / 57.12);
    expect(values[64 * 224 * 224]).toBeCloseTo((114 - 103.53) / 57.375);
    expect(() => packRslFrames(frames.slice(1))).toThrow();
  });
  it("rejects still frames before inference", () => {
    const frames = Array.from({ length: 32 }, () => new Uint8ClampedArray(RSL_FRAME_BYTES).fill(114));
    expect(rslClipHasMotion(frames)).toBe(false);
    frames[4].fill(200);
    expect(rslClipHasMotion(frames)).toBe(true);
  });
  it("uses probabilities directly and rejects blank/ambiguous output", () => {
    const output = new Float32Array(1001); output[476] = 0.9; output[33] = 0.1;
    expect(decodeRslOutput(output)?.label).toBe(RSL_LABELS[476]);
    output.fill(0); output[1000] = 1;
    expect(decodeRslOutput(output)).toBeNull();
    output.fill(0); output[5] = 0.55; output[6] = 0.45;
    expect(decodeRslOutput(output)).toBeNull();
    output[5] = NaN;
    expect(() => decodeRslOutput(output)).toThrow();
    expect(() => decodeRslOutput(new Float32Array(400))).toThrow();
  });
});
