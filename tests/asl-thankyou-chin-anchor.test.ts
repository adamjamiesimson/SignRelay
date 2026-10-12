import { describe, expect, it } from "vitest";
import { recognizeAslStarter } from "../lib/asl-starter-recognition";
import { makeSign } from "./fixtures/asl-motion";

describe("ASL THANK YOU versus upper-face movement", () => {
  it.each(["Right", "Left"] as const)("preserves a chin-anchored THANK YOU on %s hand", side => {
    const frames = makeSign("THANK YOU", { side, duration: 1400, count: 25 });
    expect(recognizeAslStarter(frames)?.label).toBe("THANK YOU");
  });

  it("does not call a nose-anchored descending hand movement THANK YOU", () => {
    // Kinematic counterexample: the same outward movement begins nearer the
    // nose than the mouth. It must not be accepted solely on mouth proximity.
    // This is synthetic coverage, not a real signed HELLO accuracy test.
    const frames = makeSign("THANK YOU", { duration: 1400, count: 25 });
    for (const frame of frames) {
      frame.face[3] = { ...frame.face[3], y: 0.40 };
      frame.pose[9] = { ...frame.pose[9], y: 0.40 };
    }
    expect(recognizeAslStarter(frames)?.label).not.toBe("THANK YOU");
  });

  it("keeps the chin-anchored rule robust under camera scaling", () => {
    const frames = makeSign("THANK YOU", { duration: 1400, count: 25, scale: 0.8, shiftY: 0.03 });
    expect(recognizeAslStarter(frames)?.label).toBe("THANK YOU");
  });
});
