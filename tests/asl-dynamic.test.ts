import { describe, expect, it } from "vitest";
import { recognizeAslStarter } from "../lib/asl-starter-recognition";
import { analyzeSignMotion } from "../lib/sign-motion";
import { makeSign } from "./fixtures/asl-motion";

describe("common ASL temporal rules (synthetic regressions, not measured accuracy)", () => {
  for (const sign of ["HELLO", "NO", "YES", "PLEASE", "SORRY", "THANK YOU"] as const) {
    it.each([
      { duration: 450, count: 13, scale: 0.65, shiftY: 0.16, side: "Right" as const },
      { duration: 900, count: 21, scale: 1, shiftY: 0, side: "Left" as const, jitter: 0.002 },
      { duration: 1800, count: 37, scale: 1.15, shiftY: -0.06, side: "Right" as const },
    ])(`${sign} at different speeds, framing and dominant hand: %j`, options => {
      expect(recognizeAslStarter(makeSign(sign, options))?.label).toBe(sign);
    });
  }
  it("uses pose cues when the face mesh drops", () => {
    expect(recognizeAslStarter(makeSign("HELLO").map(frame => ({ ...frame, face: [] })))?.label).toBe("HELLO");
  });
  it("tolerates a brief hand tracking gap", () => {
    const frames = makeSign("HELLO");
    frames[6].hands = []; frames[7].hands = [];
    expect(recognizeAslStarter(frames)?.label).toBe("HELLO");
  });
  it("keeps the body reference stable through a pose-tracking gap", () => {
    const frames = makeSign("PLEASE");
    for (let index = 6; index < 10; index++) frames[index].pose = [];
    expect(recognizeAslStarter(frames)?.label).toBe("PLEASE");
  });
  it("does not translate a static open hand or an idle jittering hand", () => {
    expect(recognizeAslStarter(makeSign("IDLE"))).toBeNull();
    expect(recognizeAslStarter(makeSign("IDLE", { jitter: 0.003 }))).toBeNull();
  });
  it("does not replay a wave after the hand disappears", () => {
    const frames = makeSign("HELLO"); frames.at(-1)!.hands = [];
    expect(recognizeAslStarter(frames)).toBeNull();
  });
  it("rejects long gaps and malformed current landmarks", () => {
    const frames = makeSign("NO"); frames.at(-1)!.timestamp += 500;
    expect(recognizeAslStarter(frames)).toBeNull();
    const malformed = makeSign("HELLO"); malformed.at(-1)!.hands[0].landmarks[8].x = NaN;
    expect(recognizeAslStarter(malformed)).toBeNull();
  });
  it("does not call a one-finger pinch NO", () => {
    const frames = makeSign("NO");
    const middle = frames[0].hands[0].landmarks[12];
    for (const frame of frames) frame.hands[0].landmarks[12] = { ...middle };
    expect(recognizeAslStarter(frames)?.label).not.toBe("NO");
  });
});

describe("movement segmentation", () => {
  it("admits finger-only motion with a stationary wrist", () => {
    const frames = makeSign("NO");
    expect(new Set(frames.map(frame => frame.hands[0].landmarks[0].x)).size).toBe(1);
    expect(analyzeSignMotion(frames).ready).toBe(true);
  });
  it("admits a brief sign and preserves its beginning", () => {
    const frames = makeSign("HELLO", { duration: 600, count: 13 });
    const result = analyzeSignMotion(frames);
    expect(result.ready).toBe(true);
    expect(result.sequence[0].timestamp).toBe(frames[0].timestamp);
  });
  it("rejects idle jitter, missing hands and unfinished movement", () => {
    expect(analyzeSignMotion(makeSign("IDLE", { jitter: 0.002 })).ready).toBe(false);
    const missing = makeSign("HELLO"); missing.at(-1)!.hands = [];
    expect(analyzeSignMotion(missing).reason).toBe("hands");
    expect(analyzeSignMotion(makeSign("HELLO").slice(0, 10)).ready).toBe(false);
  });
  it("does not interpret loss of pose tracking as a moving hand", () => {
    const frames = makeSign("IDLE");
    for (let index = 7; index < 13; index++) frames[index].pose = [];
    expect(analyzeSignMotion(frames).ready).toBe(false);
  });
});
