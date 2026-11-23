import { describe, expect, it } from "vitest";
import { analyzeAslStarter, recognizeAslStarter } from "../lib/asl-starter-recognition";
import { makeSign } from "./fixtures/asl-motion";

// Kinematic regressions only: these do not replace unseen-signer recordings.
describe("ASL chest-circle completion", () => {
  it.each(["PLEASE", "SORRY"] as const)(
    "does not accept an unfinished %s chest arc as a complete sign", sign => {
      const full = makeSign(sign, { duration: 900, count: 21 });
      // A 12-frame suffix of this motion sweeps >4.2 radians. The old angle-
      // only rule called it a completed circle before the hand returned.
      for (const observed of [12, 13]) {
        const incomplete = full.slice(0, observed);
        const analysis = analyzeAslStarter(incomplete);
        expect(analysis.labels, `${sign}: ${observed} frames`).not.toContain(sign);
        expect(recognizeAslStarter(incomplete)).toBeNull();
      }
    },
  );

  it.each(["PLEASE", "SORRY"] as const)(
    "still detects completed %s circles for either hand at different speeds", sign => {
      for (const side of ["Left", "Right"] as const) {
        for (const duration of [500, 900, 1500]) {
          const result = analyzeAslStarter(makeSign(sign, { side, duration, count: 21 }));
          expect(result.prediction?.label, `${sign} ${side} ${duration}ms`).toBe(sign);
          expect(result.ambiguousOpenPalm).toBe(false);
        }
      }
    },
  );

  it("keeps the outward THANK YOU motion distinct from chest-circle rules", () => {
    const analysis = analyzeAslStarter(makeSign("THANK YOU"));
    expect(analysis.prediction?.label).toBe("THANK YOU");
    expect(analysis.labels).not.toContain("PLEASE");
  });
});

describe("degenerate loops", () => {
  it("does not treat a fist lifted and lowered along one line as a SORRY circle", async () => {
    const { NEGATIVE_CONTROLS } = await import("./fixtures/asl-negative-controls");
    const { analyzeAslStarter } = await import("../lib/asl-starter-recognition");
    const frames = NEGATIVE_CONTROLS["lifting a fist as if holding a cup"]();
    for (let n = 6; n <= frames.length; n++) expect(analyzeAslStarter(frames.slice(0, n)).labels).not.toContain("SORRY");
  });
});
