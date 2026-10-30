import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FEATURES, landmarkSignFeatures, SEQUENCE } from "../lib/landmark-sign-features";
import type { VisionFrame } from "../lib/vision-types";

describe("PopSign landmark candidate features", () => {
  it("match the Python training features on a clip with missing hands, pose and low visibility", () => {
    const fixture = JSON.parse(readFileSync("tests/fixtures/landmark-sign-features.json", "utf8")) as { frames: VisionFrame[]; features: number[] };
    const features = landmarkSignFeatures(fixture.frames)!;
    expect(features).toHaveLength(SEQUENCE * FEATURES);
    let worst = 0;
    features.forEach((value, index) => { worst = Math.max(worst, Math.abs(value - fixture.features[index])); });
    expect(worst).toBeLessThan(1e-4);
  });
  it("needs observed hands and a body reference", () => {
    const fixture = JSON.parse(readFileSync("tests/fixtures/landmark-sign-features.json", "utf8")) as { frames: VisionFrame[] };
    expect(landmarkSignFeatures(fixture.frames.map(frame => ({ ...frame, hands: [] })))).toBeNull();
    expect(landmarkSignFeatures(fixture.frames.map(frame => ({ ...frame, pose: [] })))).toBeNull();
  });
});
