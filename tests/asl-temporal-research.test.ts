import { describe, expect, it } from "vitest";
import { AslMotionSpotter } from "../lib/asl-motion-spotter";
import { ASL_TEMPORAL_FEATURES, ASL_TEMPORAL_WIDTH, describeAslTemporal } from "../lib/asl-temporal-features";
import { parseAslTemporalModel, predictAslTemporal } from "../lib/asl-temporal-model";
import type { VisionFrame } from "../lib/vision-types";
import { makeSign } from "./fixtures/asl-motion";

function hold(frames: VisionFrame[], count = 12, absent = false) {
  const last = frames.at(-1)!;
  return [...frames, ...Array.from({ length: count }, (_, index) => ({
    ...last, hands: absent ? [] : last.hands, timestamp: last.timestamp + 50 * (index + 1),
  }))];
}

function segments(frames: VisionFrame[]) {
  const spotter = new AslMotionSpotter();
  return frames.flatMap(frame => spotter.push(frame) ?? []);
}

describe("ASL temporal research contract", () => {
  it("canonicalizes mirrored handedness and never populates unobserved time bins", () => {
    const right = describeAslTemporal(makeSign("THANK YOU", { count: 9 }))!;
    const left = describeAslTemporal(makeSign("THANK YOU", { count: 9, side: "Left" }))!;
    expect(right.features).toHaveLength(ASL_TEMPORAL_WIDTH);
    expect(right.observedBins).toBe(9);
    expect(left.features.map(value => value.toFixed(6).replace(/^-0\.0+$/, "0.000000"))).toEqual(
      right.features.map(value => value.toFixed(6).replace(/^-0\.0+$/, "0.000000")));
    expect(describeAslTemporal([...makeSign("HELLO"), makeSign("HELLO")[0]])).toBeNull();
  });

  it.each([520, 1600])("waits for a boundary after a %i ms movement", duration => {
    const frames = makeSign("HELLO", { duration, count: 16 });
    expect(segments(frames.slice(0, 11))).toEqual([]);
    const observed = hold(frames);
    const result = segments(observed);
    expect(result).toHaveLength(1);
    expect(result[0].boundary).toBe("rest");
    expect(result[0].frames.every(frame => observed.includes(frame))).toBe(true);
  });

  it("rejects rest, a brief partial movement and a stream interrupted by a timestamp gap", () => {
    expect(segments(hold(makeSign("IDLE")))).toEqual([]);
    expect(segments(hold(makeSign("YES", { duration: 140, count: 6 }), 12, true))).toEqual([]);
    const frames = makeSign("HELLO");
    const interrupted = frames.slice(0, 8);
    expect(segments([...interrupted, ...hold([frames[7]], 10, true).slice(1)
      .map(frame => ({ ...frame, timestamp: frame.timestamp + 1000 }))])).toEqual([]);
  });

  it("proposes separate boundaries for repeated movements with observed rest", () => {
    const first = hold(makeSign("HELLO"));
    const second = hold(makeSign("HELLO")).map(frame => ({ ...frame, timestamp: frame.timestamp + 1550 }));
    const found = segments([...first, ...second]);
    expect(found).toHaveLength(2);
    expect(found[0].frames.at(-1)!.timestamp).toBeLessThan(found[1].frames[0].timestamp);
  });

  it("checks label mapping, model dimensions, unknown predictions and score margin", () => {
    const zeros = Array<number>(ASL_TEMPORAL_WIDTH).fill(0);
    const model = {
      schema: ASL_TEMPORAL_FEATURES, architecture: "ridge", labels: ["HELLO", "THANK YOU", "PLEASE", "YES", "NO", "[UNKNOWN]"],
      mean: zeros, scale: zeros.map(() => 1), weights: Array.from({ length: 6 }, () => zeros),
      bias: [1, 0.8, 0, 0, 0, 0], threshold: { score: 0.7, margin: 0.3 },
      training_manifest_sha256: "e".repeat(64),
    };
    expect(predictAslTemporal(parseAslTemporalModel(model), zeros)).toMatchObject({ top: "HELLO", accepted: null });
    expect(predictAslTemporal(parseAslTemporalModel({ ...model, bias: [1, 0, 0, 0, 0, 1.5] }), zeros)).toMatchObject({ top: "[UNKNOWN]", accepted: null });
    expect(predictAslTemporal(parseAslTemporalModel({ ...model, bias: [1, 0, 0, 0, 0, 0] }), zeros)).toMatchObject({ top: "HELLO", accepted: "HELLO" });
    expect(() => parseAslTemporalModel({ ...model, scale: zeros })).toThrow("Incompatible");
    expect(() => parseAslTemporalModel({ ...model, labels: Array(6).fill("HELLO") })).toThrow("Incompatible");
  });
});
