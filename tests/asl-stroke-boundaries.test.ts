import { describe, expect, it } from "vitest";
import { analyzeAslStarter, recognizeAslStarter } from "../lib/asl-starter-recognition";
import { apparentCircleFromBodyMotion, approachMouthThenDepart, continuingChestCircle,
  mouthDepartureWithReturningWrist } from "./fixtures/asl-stroke-boundaries";

describe("ASL movement boundaries (kinematic controls, not accuracy evidence)", () => {
  it("recognizes a completed loop within a continuing circular movement", () => {
    expect(recognizeAslStarter(continuingChestCircle())?.label).toBe("PLEASE");
  });
  it.each([false, true])("does not turn body-reference motion into a circle: hand follows body=%s", follows => {
    expect(recognizeAslStarter(apparentCircleFromBodyMotion(follows))).toBeNull();
  });
  it("finds the mouth stroke after preparation instead of using the window's first frame", () => {
    expect(recognizeAslStarter(approachMouthThenDepart())?.label).toBe("THANK YOU");
  });
  it("does not call a vertical approach and return THANK YOU without outward evidence", () => {
    expect(recognizeAslStarter(approachMouthThenDepart(false))).toBeNull();
  });
  it("withholds PLEASE when an open hand departs the mouth despite a returning wrist", () => {
    const result = analyzeAslStarter(mouthDepartureWithReturningWrist());
    expect(result.labels).not.toContain("PLEASE");
    expect(result.incompleteLabels).toContain("THANK YOU");
    expect(result.ambiguousOpenPalm).toBe(true);
    expect(result.prediction).toBeNull();
  });
});
