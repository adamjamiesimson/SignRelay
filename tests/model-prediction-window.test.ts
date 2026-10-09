import { describe, expect, it } from "vitest";
import { retainAslPredictionAcrossMotionGap } from "../lib/model-prediction-window";

describe("safe ASL asynchronous model grace", () => {
  it("permits only short continuously tracked motion/idle gaps", () => {
    expect(retainAslPredictionAcrossMotionGap("moving", 100)).toBe(true);
    expect(retainAslPredictionAcrossMotionGap("idle", 450)).toBe(true);
    expect(retainAslPredictionAcrossMotionGap("moving", 451)).toBe(false);
    expect(retainAslPredictionAcrossMotionGap("idle", 800)).toBe(false);
  });
  it("invalidates immediately after losing hands or invalid timing", () => {
    expect(retainAslPredictionAcrossMotionGap("hands", 10)).toBe(false);
    expect(retainAslPredictionAcrossMotionGap("hands", 0)).toBe(false);
    expect(retainAslPredictionAcrossMotionGap("moving", -1)).toBe(false);
    expect(retainAslPredictionAcrossMotionGap("idle", Infinity)).toBe(false);
    expect(retainAslPredictionAcrossMotionGap("ready", 0)).toBe(false);
  });
});
