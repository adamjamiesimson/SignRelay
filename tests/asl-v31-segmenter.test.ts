import { describe, expect, it } from "vitest";
import { hasHand, N_POINTS } from "../engine-v3/web/preprocess.mjs";
import { AslV31Segmenter } from "../lib/asl-v31-segmenter";

/** Shoulders at y = 0.5, 0.2 apart put the signing-space limit at y = 0.76, so a hand at 0.4 is
 * signing. Every case below uses this unless it is specifically testing a frame without pose. */
function features(hand: boolean, x = 0.4) {
  const frame = new Float32Array(N_POINTS * 3).fill(NaN);
  frame.set([0.4, 0.5, 0], (42 + 7) * 3);
  frame.set([0.6, 0.5, 0], (42 + 8) * 3);
  if (hand) frame.set([x, 0.4, 0]);
  return frame;
}

/** A frame with hands only: no pose, which is what a close-up webcam crop produces. */
function unposed(wristY: number | null, x = 0.4) {
  const frame = new Float32Array(N_POINTS * 3).fill(NaN);
  if (wristY !== null) frame.set([x, wristY, 0]);
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

  describe("rest-aware sign ends (shoulders visible)", () => {
    // Shoulders at y = 0.5, 0.2 apart: signing space ends at y = 0.5 + 1.3 * 0.2 = 0.76.
    function posed(handY: number | null) {
      const frame = features(false);
      if (handY !== null) frame.set([0.5, handY, 0]);
      return frame;
    }
    const run = (segmenter: AslV31Segmenter, ys: (number | null)[], start: number) =>
      ys.map((y, index) => segmenter.observe(start + index * 100, posed(y)));

    it("ends a sign when the hand rests visibly below signing space, then recognizes the next sign", () => {
      const segmenter = new AslV31Segmenter();
      const first = run(segmenter, [0.4, 0.4, 0.4, 0.4, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9], 0);
      expect(first.filter(result => result.clip)).toHaveLength(1);
      expect(first.at(-1)?.reason).toBe("idle");
      const second = run(segmenter, [0.4, 0.4, 0.4, 0.4, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9], 2000);
      expect(second.filter(result => result.clip)).toHaveLength(1);
    });

    it("keeps the PR #67 behaviour when disabled: a visible resting hand holds the segment to the cap", () => {
      const segmenter = new AslV31Segmenter({ restAware: false });
      const results = run(segmenter, [0.4, 0.4, 0.4, 0.4, ...new Array(40).fill(0.9)], 0);
      expect(results.findIndex(result => result.clip)).toBeGreaterThan(30);
    });

    it("treats a visible resting hand as rest after a capped segment", () => {
      const segmenter = new AslV31Segmenter();
      const capped = run(segmenter, new Array(45).fill(0.4), 0);
      expect(capped.filter(result => result.clip)).toHaveLength(1);
      run(segmenter, new Array(7).fill(0.9), 4500);
      const next = run(segmenter, [0.4, 0.4, 0.4, 0.4, null, null, null, null, null, null, null], 5200);
      expect(next.filter(result => result.clip)).toHaveLength(1);
    });
  });

  describe("no shoulders in view (close-up webcam crop)", () => {
    // A 3 s triangle-wave stroke moving 0.02 of the frame per 100 ms frame, so any 250 ms
    // window shows at least 0.05 of travel. A constant position is a hand resting in view.
    const stroke = (index: number) => 0.35 + 0.3 * Math.abs(((index / 15) % 2) - 1);
    const feed = (segmenter: AslV31Segmenter, start: number, count: number, position: (index: number) => number) =>
      Array.from({ length: count }, (_, index) => segmenter.observe(start + index * 100, unposed(0.4, position(index))));
    const moving = (segmenter: AslV31Segmenter, start: number, count: number, phase = 0) =>
      feed(segmenter, start, count, index => stroke(index + phase));
    const still = (segmenter: AslV31Segmenter, start: number, count: number, x = 0.5) =>
      feed(segmenter, start, count, () => x);

    it("recognises a second sign without the hand ever leaving the picture", () => {
      const segmenter = new AslV31Segmenter();
      const first = [...moving(segmenter, 0, 12), ...still(segmenter, 1200, 30)];
      expect(first.filter(result => result.clip)).toHaveLength(1);
      expect(segmenter.stats.capped).toBe(0);
      const second = [...moving(segmenter, 4200, 12, 5), ...still(segmenter, 5400, 30)];
      expect(second.filter(result => result.clip)).toHaveLength(1);
    });

    it("does not open a sign for a hand that is resting in view", () => {
      const segmenter = new AslV31Segmenter();
      const results = still(segmenter, 0, 30);
      expect(results.filter(result => result.clip)).toHaveLength(0);
      expect(segmenter.stats.opened).toBe(0);
      expect(results.at(-1)?.reason).toBe("idle");
    });

    it("ends a capped sign when the movement stops and accepts the next one", () => {
      const segmenter = new AslV31Segmenter();
      const capped = moving(segmenter, 0, 45);
      expect(capped.filter(result => result.clip)).toHaveLength(1);
      expect(segmenter.stats.capped).toBe(1);
      const after = [...still(segmenter, 4500, 10), ...moving(segmenter, 5500, 12, 5), ...still(segmenter, 6700, 30)];
      expect(after.filter(result => result.clip)).toHaveLength(1);
    });
  });
});
