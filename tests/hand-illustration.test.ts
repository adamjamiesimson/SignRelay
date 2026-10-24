import { describe, expect, it } from "vitest";
import {
  DEMO_SEQUENCE, LOOP_MS, SIGN_MOTION, STEP_MS, STILL_FRAME, TIMING, bonesPath, frameAt, handPoints, palmPath, visibleTips,
} from "../lib/hand-illustration";

const span = (points: { x: number; y: number }[]) => Math.max(...points.map(p => Math.hypot(p.x - points[0].x, p.y - points[0].y)));

describe("homepage hand illustration", () => {
  it("draws two 21-point hands that stay inside the 400×300 frame", () => {
    for (let ms = 0; ms < LOOP_MS; ms += 40) {
      const { scene } = frameAt(ms);
      for (const [pose, side] of [[scene.dominant, 1], [scene.support, -1]] as const) {
        const points = handPoints(pose, side);
        expect(points).toHaveLength(21);
        for (const { x, y } of points) {
          expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
          expect(x).toBeGreaterThan(-10); expect(x).toBeLessThan(410);
          expect(y).toBeGreaterThan(0); expect(y).toBeLessThan(330);
        }
      }
    }
  });

  it("moves smoothly: no jump between consecutive 60 fps frames, across sign boundaries too", () => {
    let previous = handPoints(frameAt(0).scene.dominant);
    for (let ms = 16; ms < LOOP_MS * 1.02; ms += 16) {
      const points = handPoints(frameAt(ms).scene.dominant);
      const jump = Math.max(...points.map((p, i) => Math.hypot(p.x - previous[i].x, p.y - previous[i].y)));
      expect(jump).toBeLessThan(9);
      previous = points;
    }
  });

  it("walks through every demo sign with watching, checking and result phases", () => {
    const seen = DEMO_SEQUENCE.map((_, index) => new Set(
      Array.from({ length: Math.ceil(STEP_MS / 50) }, (_, i) => frameAt(index * STEP_MS + i * 50)).filter(frame => frame.index === index).map(frame => frame.phase)));
    for (const phases of seen) expect([...phases].sort()).toEqual(["checking", "result", "watching"]);
    expect(frameAt(TIMING.transition + TIMING.perform + 10).phase).toBe("result");
  });

  it("only pulses for a confirmed word, never for the no-match example", () => {
    const abstain = DEMO_SEQUENCE.findIndex(item => !item.confirmed);
    const pulses = Array.from({ length: 40 }, (_, i) => frameAt(abstain * STEP_MS + TIMING.transition + TIMING.perform + i * 25).pulse);
    expect(pulses.every(value => value === 0)).toBe(true);
    expect(frameAt(TIMING.transition + TIMING.perform + 300).pulse).toBeGreaterThan(0);
  });

  it("has a motion for every demo sign and a still frame for reduced motion", () => {
    for (const item of DEMO_SEQUENCE) expect(SIGN_MOTION[item.sign]).toBeTypeOf("function");
    expect(STILL_FRAME.phase).toBe("result");
    expect(DEMO_SEQUENCE[STILL_FRAME.index].confirmed).toBe(true);
  });

  it("keeps a natural hand: a fist is more compact than an open hand and hides folded tips", () => {
    const open = handPoints(SIGN_MOTION.HELLO(1).dominant);
    const fistPose = SIGN_MOTION.YES(0).dominant;
    const fist = handPoints(fistPose);
    expect(span(fist)).toBeLessThan(span(open) * 0.75);
    expect(visibleTips(fist, fistPose)).toHaveLength(0);
    expect(visibleTips(open, SIGN_MOTION.HELLO(1).dominant)).toHaveLength(5);
  });

  it("produces compact SVG paths", () => {
    const points = handPoints(SIGN_MOTION.PLEASE(0.5).dominant);
    expect(bonesPath(points)).toMatch(/^M[\d.-]+ [\d.-]+L/);
    expect(palmPath(points).endsWith("Z")).toBe(true);
    expect(bonesPath(points).length).toBeLessThan(600);
  });
});
