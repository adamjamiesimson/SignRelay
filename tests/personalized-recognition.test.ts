import { describe, expect, it } from "vitest";
import { ASL_BUILT_IN_VOCABULARY, ASL_VOCABULARY, LANGUAGE_LIST, MODEL_ADAPTERS, PERSONAL_STARTER_VOCABULARY, createCustomAslVocabularyEntry } from "../lib/model-adapters";
import { hasAsl100CompletedSignMotion, hasAsl100HandEvidence } from "../lib/asl100-runtime";
import { halfToFloat, prepareTgcnInput } from "../lib/asl1000-runtime";
import { prepareCalibrationSequence, sequenceDistance, templatesForLanguage } from "../lib/personalized-recognition";
import type { VisionFrame } from "../lib/vision-types";

describe("ASL vocabulary", () => {
  it("ships 2,000 distinct built-in WLASL signs without personal calibration", () => {
    expect(ASL_BUILT_IN_VOCABULARY).toHaveLength(2000);
    expect(new Set(ASL_BUILT_IN_VOCABULARY.map((word) => word.gloss)).size).toBe(2000);
    expect(ASL_VOCABULARY).toHaveLength(2000);
  });

  it("creates a safe personal vocabulary entry from a typed word or phrase", () => {
    expect(createCustomAslVocabularyEntry("  pizza   night! ")).toMatchObject({ gloss: "PIZZA NIGHT", text: "pizza night", category: "custom" });
    expect(createCustomAslVocabularyEntry("  !!! ")).toBeNull();
  });

  it("exposes separate ASL, BSL, CSL and ISL recognition paths", () => {
    expect(LANGUAGE_LIST.map((language) => language.id)).toEqual(["asl", "bsl", "isl", "csl"]);
    expect(LANGUAGE_LIST.filter((language) => language.status === "personal").map((language) => language.id).sort()).toEqual(["csl"]);
    expect(MODEL_ADAPTERS.bsl.automaticVocabularyCount).toBe(1064);
    expect(MODEL_ADAPTERS.isl.automaticVocabularyCount).toBe(263);
  });

  it("includes a 2,000-plus concept library for every teachable language", () => {
    expect(PERSONAL_STARTER_VOCABULARY.length).toBeGreaterThanOrEqual(2000);
    expect(new Set(PERSONAL_STARTER_VOCABULARY.map((word) => word.gloss)).size).toBe(PERSONAL_STARTER_VOCABULARY.length);
    for (const language of ["bsl", "csl", "isl"] as const) {
      expect(MODEL_ADAPTERS[language].vocabulary.length).toBeGreaterThanOrEqual(2000);
    }
  });

  it("keeps personal sign templates inside their selected language", () => {
    const templates = [
      { id: "old-asl", gloss: "HELLO", text: "Hello", createdAt: 1, frames: [] },
      { id: "bsl-hello", language: "bsl" as const, gloss: "HELLO", text: "Hello", createdAt: 2, frames: [] },
      { id: "isl-help", language: "isl" as const, gloss: "HELP", text: "Help", createdAt: 3, frames: [] },
    ];
    expect(templatesForLanguage(templates, "asl").map((item) => item.id)).toEqual(["old-asl"]);
    expect(templatesForLanguage(templates, "bsl").map((item) => item.id)).toEqual(["bsl-hello"]);
    expect(templatesForLanguage(templates, "csl")).toEqual([]);
  });

  it("does not run the built-in ASL model without sustained hand tracking", () => {
    const empty = Array.from({ length: 24 }, (_, index) => ({ ...makeFrame(index / 100), hands: [] }));
    expect(hasAsl100HandEvidence(empty)).toBe(false);
    expect(hasAsl100HandEvidence(Array.from({ length: 24 }, (_, index) => makeFrame(index / 100)))).toBe(true);
  });

  it("requires movement followed by a settled end pose before the generic model runs", () => {
    const idle = Array.from({ length: 24 }, () => makeFrame(0));
    const waving = Array.from({ length: 24 }, (_, index) => makeFrame(index % 2 ? 0.12 : -0.12));
    const completed = Array.from({ length: 24 }, (_, index) => makeFrame(index < 15 ? index * 0.012 : 0.168));
    const naturalCompleted = Array.from({ length: 24 }, (_, index) => makeFrame(index < 15 ? index * 0.008 : 0.12 + (index % 2 ? 0.018 : -0.018)));
    expect(hasAsl100CompletedSignMotion(idle)).toBe(false);
    expect(hasAsl100CompletedSignMotion(waving)).toBe(false);
    expect(hasAsl100CompletedSignMotion(completed)).toBe(true);
    expect(hasAsl100CompletedSignMotion(naturalCompleted)).toBe(true);
  });

  it("maps live landmarks to the 55-node, 50-frame Pose-TGCN contract", () => {
    const prepared = prepareTgcnInput(Array.from({ length: 30 }, (_, index) => makeFrame(index / 100)));
    expect(prepared).toHaveLength(55 * 50 * 2);
    expect(Number.isFinite(prepared[0])).toBe(true);
    expect(halfToFloat(0x3c00)).toBe(1);
    expect(halfToFloat(0xc000)).toBe(-2);
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
