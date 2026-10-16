import { describe, expect, it } from "vitest";
import { analyzeAslStarter, recognizeAslStarter } from "../lib/asl-starter-recognition";
import { incompleteArcWithOutwardSuffix } from "./fixtures/asl-ambiguous-arc";
import { makeSign } from "./fixtures/asl-motion";

// A small open hand waving along a slightly curved path. Short suffixes can
// satisfy THANK YOU while the full wave satisfies HELLO. This is a control
// counterexample, not a recording or evidence of sign-level precision.
function ambiguousWave() {
  const frames = makeSign("HELLO", { duration: 1800, count: 37 });
  frames.forEach((frame, i) => {
    const wrist = { ...frame.hands[0].landmarks[0] };
    frame.hands[0].landmarks.forEach(point => {
      point.x = wrist.x + (point.x - wrist.x) * 0.35;
      point.y = wrist.y + (point.y - wrist.y) * 0.35 + 0.02 + 0.02 * Math.cos(Math.min(1, i / 36 / 0.75) * 2 * Math.PI);
    });
  });
  return frames.slice(0, 30);
}
describe("conflicting open-palm evidence", () => {
  it("abstains when different temporal windows indicate HELLO and THANK YOU", () => {
    const analysis = analyzeAslStarter(ambiguousWave());
    expect(analysis.labels).toEqual(expect.arrayContaining(["HELLO", "THANK YOU"]));
    expect(analysis.ambiguousOpenPalm).toBe(true);
    expect(recognizeAslStarter(ambiguousWave())).toBeNull();
  });
  it("retains incomplete PLEASE evidence when completion removes its permission to emit", () => {
    const analysis = analyzeAslStarter(incompleteArcWithOutwardSuffix().slice(0, 23));
    expect(analysis.labels).toEqual(["THANK YOU"]);
    expect(analysis.incompleteLabels).toEqual(["PLEASE"]);
    expect(analysis.ambiguousOpenPalm).toBe(true);
    expect(analysis.prediction).toBeNull();
  });
  it.each(["HELLO", "PLEASE", "THANK YOU"] as const)("retains unambiguous %s positives", sign => {
    expect(analyzeAslStarter(makeSign(sign))).toMatchObject({ ambiguousOpenPalm: false, prediction: { label: sign } });
  });
});
