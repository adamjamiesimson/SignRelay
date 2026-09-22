import { describe, expect, it } from "vitest";
import { packKslFrame, prepareKslInput, type KslHolisticFrame } from "../lib/ksl-input";
const empty = (): KslHolisticFrame => ({ pose: [], leftHand: [], rightHand: [], faceMesh: [] });
const point = (value: number, visibility = 1) => ({ x: value, y: value + 1, z: -value, visibility });

describe("Korean Holistic input contract", () => {
  it("preserves anatomical sides, synthetic joints, face order and confidence", () => {
    const frame: KslHolisticFrame = {
      pose: Array.from({ length: 33 }, (_, i) => point(i, i === 11 ? 0.25 : 0.75)),
      leftHand: Array.from({ length: 21 }, (_, i) => point(i + 100, 0)),
      rightHand: Array.from({ length: 21 }, (_, i) => point(i + 200, 0)),
      faceMesh: Array.from({ length: 478 }, (_, i) => point(i + 300, 0)),
    };
    const values = packKslFrame(frame);
    const at = (i: number) => Array.from(values.slice(i * 4, i * 4 + 4));
    expect(at(0)).toEqual([11.5, 12.5, -11.5, 0.25]);
    expect(at(1)).toEqual([11, 12, -11, 0.25]);
    expect(at(3)).toEqual([13, 14, -13, 0.75]);
    expect(at(12)).toEqual([23.5, 24.5, -23.5, 0.75]);
    expect(at(13)).toEqual([100, 101, -100, 1]);
    expect(at(34)).toEqual([200, 201, -200, 1]);
    expect(at(55)).toEqual([361, 362, -361, 1]);
    expect(at(114)).toEqual([627, 628, -627, 1]);
  });
  it("keeps missing observations zero and pads without repeating", () => {
    const frame = empty(); frame.leftHand = Array.from({ length: 21 }, () => point(0.5));
    const { values, length } = prepareKslInput([frame, empty()]);
    expect(length).toBe(2); expect(values.length).toBe(64 * 460);
    expect(values[52]).toBe(0.5);
    expect(values.slice(460).every(value => value === 0)).toBe(true);
  });
  it("resamples long cached clips including both endpoints", () => {
    const frames = Array.from({ length: 128 }, (_, i) => ({ ...empty(), leftHand: Array(21).fill(point(i)) }));
    const { values, length } = prepareKslInput(frames);
    expect(length).toBe(64);
    expect(values[52]).toBe(0); expect(values[31 * 460 + 52]).toBe(62);
    expect(values[32 * 460 + 52]).toBe(65); expect(values[63 * 460 + 52]).toBe(127);
  });
  it("rejects compressed faces, partial observations and invalid coordinates", () => {
    expect(() => prepareKslInput([])).toThrow("nonempty");
    expect(() => packKslFrame({ ...empty(), faceMesh: Array(20).fill(point(0)) })).toThrow("full indexed face");
    expect(() => packKslFrame({ ...empty(), pose: Array(13).fill(point(0)) })).toThrow("33");
    expect(() => packKslFrame({ ...empty(), leftHand: Array(21).fill(point(NaN)) })).toThrow("finite");
  });
});
