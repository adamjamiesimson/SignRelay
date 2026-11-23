import { describe, expect, it } from "vitest";
import { hasHand, N_POINTS } from "../engine-v3/web/preprocess.mjs";
import { AslV31Segmenter } from "../lib/asl-v31-segmenter";

function features(hand: boolean, x = 0.4) {
  const frame = new Float32Array(N_POINTS * 3).fill(NaN);
  if (hand) frame.set([x, 0.4, 0]);
  return frame;
}

describe("V3.1 segmentation (synthetic timing checks)", () => {
  it("waits through an interior tracking gap and produces one completed segment", () => {
    const segmenter = new AslV31Segmenter();
    const steps = [true, true, false, true, true, false, false, false, false];
    const results = steps.map((hand, index) => segmenter.observe(index * 200, features(hand, index / 10)));
    const clips = results.flatMap(result => result.clip ? [result.clip] : []);
    expect(clips).toHaveLength(1);
    expect(clips[0].some(hasHand)).toBe(true);
    expect(results[2].reason).toBe("moving");
    expect(results[7].reason).toBe("ready");
  });

  it("requires three actual hand frames, even when two observations could fill a 15 Hz grid", () => {
    const segmenter = new AslV31Segmenter();
    const results = [true, true, false, false, false].map((hand, index) => segmenter.observe(index * 200, features(hand)));
    expect(results.some(result => result.clip)).toBe(false);
  });

  it("caps a long visible event and does not reopen it before a hand-down rest", () => {
    const segmenter = new AslV31Segmenter();
    const count = (steps: boolean[], start: number) => steps.reduce((total, hand, index) =>
      total + Number(!!segmenter.observe(start + index * 100, features(hand)).clip), 0);
    expect(count(Array.from({ length: 150 }, () => true), 0)).toBe(1);
    expect(count(Array.from({ length: 8 }, () => false), 15000)).toBe(0);
    expect(count([true, true, true, false, false, false, false, false, false], 15800)).toBe(1);
  });

  it("does not reuse a personal-template event's tail or a pre-reset segment", () => {
    const segmenter = new AslV31Segmenter();
    for (let t = 0; t < 1000; t += 100) segmenter.observe(t, features(true));
    segmenter.suppressCurrentSegment();
    for (let t = 1000; t < 2300; t += 100) expect(segmenter.observe(t, features(t < 1700)).clip).toBeUndefined();
    for (let t = 2300; t < 3000; t += 100) segmenter.observe(t, features(true));
    segmenter.reset();
    for (let t = 3000; t < 4000; t += 100) expect(segmenter.observe(t, features(false)).clip).toBeUndefined();
  });
});
