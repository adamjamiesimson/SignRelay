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
    const results = [true, true, false, false, false].map((hand, index) => segmenter.observe(index * 200, features(hand, index / 10)));
    expect(results.some(result => result.clip)).toBe(false);
    expect(segmenter.stats.tooFewHands).toBe(1);
  });

  it("caps a long moving event and does not reopen it before the movement rests", () => {
    const segmenter = new AslV31Segmenter();
    const stroke = (index: number) => 0.4 + 0.3 * Math.abs(((index / 15) % 2) - 1);
    const count = (steps: boolean[], start: number) => steps.reduce((total, hand, index) =>
      total + Number(!!segmenter.observe(start + index * 100, features(hand, stroke(index))).clip), 0);
    expect(count(Array.from({ length: 150 }, () => true), 0)).toBe(1);
    expect(segmenter.stats.capped).toBe(1);
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
    // Shoulders at y = 0.5, 0.2 apart: signing space ends at y = 0.5 + 1.3 * 0.2 = 0.76, so a hand
    // at y = 0.4 is inside signing space. A hand that moves is signing; a hand that holds still is
    // resting, wherever it rests. A physical desk camera measured both wrists inside signing space
    // in every frame, which is why position alone cannot end a sign.
    const posed = (y: number, x: number) => {
      const frame = features(false);
      frame.set([x, y, 0]);
      return frame;
    };
    const stroke = (index: number) => 0.35 + 0.3 * Math.abs(((index / 15) % 2) - 1);
    const move = (segmenter: AslV31Segmenter, start: number, count: number, y = 0.4, phase = 0) =>
      Array.from({ length: count }, (_, index) => segmenter.observe(start + index * 100, posed(y, stroke(index + phase))));
    const hold = (segmenter: AslV31Segmenter, start: number, count: number, y = 0.9) =>
      Array.from({ length: count }, (_, index) => segmenter.observe(start + index * 100, posed(y, 0.5)));
    const clips = (results: { clip?: unknown }[]) => results.filter(result => result.clip);

    it("ends a sign when the movement stops, then recognizes the next sign", () => {
      const segmenter = new AslV31Segmenter();
      const first = [...move(segmenter, 0, 12), ...hold(segmenter, 1200, 11)];
      expect(clips(first)).toHaveLength(1);
      expect(first.at(-1)?.reason).toBe("idle");
      expect(segmenter.stats.capped).toBe(0);
      const second = [...move(segmenter, 2300, 12, 0.4, 5), ...hold(segmenter, 3500, 11)];
      expect(clips(second)).toHaveLength(1);
    });

    it("recognises every sign when the hands never leave signing space (measured desk camera)", () => {
      // Both wrists sat at y ~ 0.4-0.68 inside signing space for 61 of 61 captured frames, and the
      // shoulders were tracked in all of them, so only movement separates a sign from a resting
      // hand. Before this, the first sign capped at 4 s and the next three were never recognised.
      const segmenter = new AslV31Segmenter();
      const signs = [[0, 0.4], [2200, 0.55], [4400, 0.65]] as const;
      const results = signs.flatMap(([start, y]) => [...move(segmenter, start, 12, y), ...hold(segmenter, start + 1200, 11, y)]);
      expect(clips(results)).toHaveLength(3);
      expect(segmenter.stats).toMatchObject({ opened: 3, completed: 3, capped: 0 });
      expect(segmenter.stats.tooFewHands).toBe(0);
    });

    it("does not open a sign for a hand resting inside signing space", () => {
      const segmenter = new AslV31Segmenter();
      const results = hold(segmenter, 0, 30, 0.4);
      expect(clips(results)).toHaveLength(0);
      expect(segmenter.stats.opened).toBe(0);
    });

    it("keeps the PR #67 behaviour when disabled: a visible resting hand holds the segment to the cap", () => {
      const segmenter = new AslV31Segmenter({ restAware: false });
      const results = [...move(segmenter, 0, 4), ...hold(segmenter, 400, 40, 0.4)];
      // Held to the cap rather than ended by the rest: 2.5 s at 100 ms frames.
      expect(results.findIndex(result => result.clip)).toBeGreaterThan(24);
    });

    it("treats a resting hand as rest after a capped segment", () => {
      const segmenter = new AslV31Segmenter();
      const capped = move(segmenter, 0, 45);
      expect(clips(capped)).toHaveLength(1);
      expect(segmenter.stats.capped).toBe(1);
      // A cap owes a rest before the next sign: the wait is HAND_GAP_MS after the last movement.
      hold(segmenter, 4500, 16);
      const next = [...move(segmenter, 6100, 12, 0.4, 5), ...hold(segmenter, 7300, 11)];
      expect(clips(next)).toHaveLength(1);
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
      const after = [...still(segmenter, 4500, 16), ...moving(segmenter, 6100, 12, 5), ...still(segmenter, 7300, 30)];
      expect(after.filter(result => result.clip)).toHaveLength(1);
    });
  });
});
