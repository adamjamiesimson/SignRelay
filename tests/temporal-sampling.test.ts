import { describe, expect, it } from "vitest";
import { appendObservation } from "../lib/frame-timing";
import { prepareCalibrationSequence, recognizePersonalTemplate } from "../lib/personalized-recognition";
import { makeSign } from "./fixtures/asl-motion";
import type { VisionFrame } from "../lib/vision-types";
import { validCalibrationTemplate } from "../lib/calibration-storage";

describe("time-based observation windows", () => {
  it("does not duplicate a lone left hand into the right slot in new personal examples", () => {
    const take = makeSign("SORRY").map(frame => ({ ...frame, hands: frame.hands.map(hand => ({ ...hand, handedness: "Left" as const })) }));
    const fixed = prepareCalibrationSequence(take, "trajectory-v3");
    expect(fixed.every(row => row[0] === 1 && row[66] === 0)).toBe(true);
    expect(prepareCalibrationSequence(take).every(row => row[0] === 1 && row[66] === 0)).toBe(true);
  });
  it("keeps trajectory during pose loss, while retaining the legacy feature contract", () => {
    const take = makeSign("THANK YOU").map(frame => ({ ...frame, pose: [], face: [] }));
    const old = prepareCalibrationSequence(take), fixed = prepareCalibrationSequence(take, "trajectory-v3");
    // Right wrist x/y follow the presence bit at offset 66.
    expect(old.every(row => row[67] === 0 && row[68] === 0)).toBe(true);
    expect(fixed.at(-1)![67] - fixed[0][67]).toBeGreaterThan(0.5);
    expect(fixed.at(-1)![68] - fixed[0][68]).toBeGreaterThan(0.5);
    const saved = { id: "new", gloss: "MY SIGN", text: "My sign", createdAt: 1, normalization: "trajectory-v3" as const, frames: fixed };
    expect(validCalibrationTemplate(saved)).toBe(true);
    expect(recognizePersonalTemplate(take, [saved])?.label).toBe("MY SIGN");
    const legacy = { ...saved, normalization: undefined, frames: old };
    expect(validCalibrationTemplate(legacy)).toBe(true);
    expect(recognizePersonalTemplate(take, [legacy])?.label).toBe("MY SIGN");
    expect(validCalibrationTemplate({ ...saved, normalization: "unknown" })).toBe(false);
  });
  it("uses a nearby observed body reference through a short pose dropout", () => {
    const take = makeSign("SORRY");
    const interrupted = take.map((frame, i) => i === 8 || i === 9 ? { ...frame, pose: [] } : frame);
    const full = prepareCalibrationSequence(take, "trajectory-v3"), sparse = prepareCalibrationSequence(interrupted, "trajectory-v3");
    // Hand features are unchanged; pose presence may correctly become absent.
    expect(sparse.map(row => row.slice(0, 132))).toEqual(full.map(row => row.slice(0, 132)));
  });
  it.each([10, 20, 30, 60])("retains a 4.2 s personal movement at %i fps", fps => {
    const frames: VisionFrame[] = [];
    const take = makeSign("SORRY", { count: Math.round(fps * 4.2) + 1, duration: 4200 });
    for (const frame of take) appendObservation(frames, frame);
    expect(frames.at(-1)!.timestamp - frames[0].timestamp).toBe(4200);
    expect(frames.length).toBeLessThanOrEqual(300);
  });
  it("bounds memory, expires old movements, and resets on a backwards clock", () => {
    const frames: { timestamp: number }[] = [];
    for (let t = 0; t < 10000; t += 10) appendObservation(frames, { timestamp: t });
    expect(frames).toHaveLength(300);
    appendObservation(frames, { timestamp: 20000 });
    expect(frames).toEqual([{ timestamp: 20000 }]);
    appendObservation(frames, { timestamp: 1 });
    expect(frames).toEqual([{ timestamp: 1 }]);
  });
  it.each(["THANK YOU", "SORRY"] as const)("%s sampling is stable under uneven capture cadence", sign => {
    const uniform = makeSign(sign, { count: 121, duration: 2400 });
    // Keep all early observations but only every fifth late observation.
    const uneven = uniform.filter((_, i) => i < 30 || i % 5 === 0);
    const template = { id: sign, gloss: sign, text: sign, createdAt: 0, language: "asl" as const,
      frames: prepareCalibrationSequence(uniform) };
    expect(recognizePersonalTemplate(uneven, [template])?.label).toBe(sign);
    // Endpoints and the temporal midpoint must represent the same movement.
    const expected = prepareCalibrationSequence(uniform);
    const actual = prepareCalibrationSequence(uneven);
    expect(actual[0]).toEqual(expected[0]);
    expect(actual.at(-1)).toEqual(expected.at(-1));
    const error = actual[12].reduce((sum, x, i) => sum + Math.abs(x - expected[12][i]), 0) / actual[12].length;
    expect(error).toBeLessThan(0.02);
  });
});
