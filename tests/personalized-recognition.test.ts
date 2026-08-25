import { describe, expect, it } from "vitest";
import { ASL_BUILT_IN_VOCABULARY, ASL_VOCABULARY, createCustomAslVocabularyEntry } from "../lib/model-adapters";
import { prepareCalibrationSequence, sequenceDistance } from "../lib/personalized-recognition";
import type { VisionFrame } from "../lib/vision-types";

describe("ASL vocabulary", () => {
  it("ships 100 distinct built-in WLASL signs without personal calibration", () => {
    expect(ASL_BUILT_IN_VOCABULARY).toHaveLength(100);
    expect(new Set(ASL_BUILT_IN_VOCABULARY.map((word) => word.gloss)).size).toBe(100);
    expect(ASL_VOCABULARY).toHaveLength(100);
  });

  it("creates a safe personal vocabulary entry from a typed word or phrase", () => {
    expect(createCustomAslVocabularyEntry("  pizza   night! ")).toMatchObject({ gloss: "PIZZA NIGHT", text: "pizza night", category: "custom" });
    expect(createCustomAslVocabularyEntry("  !!! ")).toBeNull();
  });

  it("normalizes recordings to the fixed temporal contract", () => {
    const recording = Array.from({ length: 30 }, (_, index) => makeFrame(index / 100));
    const prepared = prepareCalibrationSequence(recording);
    expect(prepared).toHaveLength(24);
    expect(prepared[0].length).toBe(prepared[23].length);
  });

  it("scores an identical sign closer than a displaced sign", () => {
    const baseline = prepareCalibrationSequence(Array.from({ length: 24 }, (_, index) => makeFrame(index / 100)));
    const same = prepareCalibrationSequence(Array.from({ length: 24 }, (_, index) => makeFrame(index / 100)));
    const displaced = baseline.map((frame) => frame.map((value) => value + 0.8));
    expect(sequenceDistance(baseline, same)).toBe(0);
    expect(sequenceDistance(baseline, displaced)).toBeGreaterThan(0.5);
  });
});

function makeFrame(offset: number): VisionFrame {
  const hand = Array.from({ length: 21 }, (_, index) => ({
    x: 0.45 + offset + index * 0.001,
    y: 0.55 - index * 0.002,
    z: index * 0.0005,
  }));
  return {
    timestamp: offset * 1000,
    hands: [{ landmarks: hand, handedness: "Right", gesture: "None", gestureScore: 0 }],
    face: Array.from({ length: 20 }, (_, index) => ({ x: 0.5, y: 0.25 + index * 0.001, z: 0 })),
    pose: Array.from({ length: 17 }, (_, index) => ({ x: 0.4 + index * 0.01, y: 0.4, z: 0 })),
  };
}
