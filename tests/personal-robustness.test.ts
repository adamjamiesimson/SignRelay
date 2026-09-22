import { describe, expect, it } from "vitest";
import { calibrationFrames, prepareCalibrationSequence, recognizePersonalTemplate, sequenceDistance } from "../lib/personalized-recognition";
import type { CalibrationTemplate } from "../lib/vision-types";
import { makeSign } from "./fixtures/asl-motion";

const template = (gloss = "HELLO"): CalibrationTemplate => ({ id: gloss, gloss, text: gloss, createdAt: 1,
  language: "asl", frames: prepareCalibrationSequence(makeSign("HELLO", { duration: 1800, count: 37 })) });

describe("personal recordings", () => {
  it("retains one feature layout when pose, face or hands disappear", () => {
    const frames = makeSign("HELLO");
    frames[4].pose = []; frames[5].face = []; frames[6].hands = [];
    expect(new Set(prepareCalibrationSequence(frames).map(row => row.length))).toEqual(new Set([240]));
  });
  it("matches a faster repeat without a fixed frame-count window", () => {
    expect(recognizePersonalTemplate(makeSign("HELLO", { duration: 600, count: 13 }), [template()])?.label).toBe("HELLO");
  });
  it("records and recognizes a personal sign on a slow camera", () => {
    const frames = makeSign("HELLO", { duration: 2400, count: 9 });
    const captured = calibrationFrames(frames);
    expect(captured).toHaveLength(9);
    const saved = { ...template(), frames: prepareCalibrationSequence(captured) };
    expect(recognizePersonalTemplate(makeSign("HELLO"), [saved])?.label).toBe("HELLO");
    expect(recognizePersonalTemplate(frames, [template()])?.label).toBe("HELLO");
  });
  it("does not save or recognize recordings broken by a long pause", () => {
    const frames = makeSign("HELLO", { duration: 2400, count: 9 });
    frames.forEach((frame, index) => { if (index >= 5) frame.timestamp += 1800; });
    expect(calibrationFrames(frames)).toHaveLength(0);
    expect(recognizePersonalTemplate(frames, [template()])).toBeNull();
  });
  it("keeps older 17-point pose recordings usable", () => {
    const saved = template(); saved.frames = saved.frames.map(row => row.slice(0, 208));
    expect(recognizePersonalTemplate(makeSign("HELLO"), [saved])?.label).toBe("HELLO");
  });
  it("rejects two indistinguishable recordings with different meanings", () => {
    expect(recognizePersonalTemplate(makeSign("HELLO"), [template(), template("HELP")])).toBeNull();
  });
  it("allows several examples of the same word", () => {
    expect(recognizePersonalTemplate(makeSign("HELLO"), [template(), { ...template(), id: "second" }])?.label).toBe("HELLO");
  });
  it("rejects malformed and non-finite saved features", () => {
    const frames = template().frames;
    expect(sequenceDistance(frames, [[1]])).toBe(Infinity);
    const invalid = frames.map(row => [...row]); invalid[0][8] = NaN;
    expect(sequenceDistance(frames, invalid)).toBe(Infinity);
  });
});
