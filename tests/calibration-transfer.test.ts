import { describe, expect, it } from "vitest";
import { parseCalibrationExport, serialiseCalibration } from "../lib/calibration-transfer";
import type { CalibrationTemplate } from "../lib/vision-types";

const frames = Array.from({ length: 24 }, () => new Array(208).fill(0.1));
const template = (gloss: string, embedding?: number[]): CalibrationTemplate =>
  ({ id: `${gloss}-1`, language: "asl", gloss, text: gloss.toLowerCase(), createdAt: 1, frames, ...(embedding ? { embedding } : {}) });

describe("personal vocabulary export and import", () => {
  it("round-trips taught signs with their embeddings", () => {
    const embedding = new Array(384).fill(0).map((_, index) => (index === 0 ? 1 : 0));
    const raw = serialiseCalibration([template("PLEASE", embedding), template("HIGH")]);
    const result = parseCalibrationExport(raw);
    expect(result.skipped).toBe(0);
    expect(result.templates.map(entry => entry.gloss)).toEqual(["PLEASE", "HIGH"]);
    expect(result.templates[0].embedding).toHaveLength(384);
    expect(result.templates[1].embedding).toBeUndefined();
  });

  it("drops a corrupt embedding but keeps the sign, so the frame matcher still works", () => {
    const raw = serialiseCalibration([template("PLEASE", [1, 2, Number.NaN])]);
    const [restored] = parseCalibrationExport(raw).templates;
    expect(restored.gloss).toBe("PLEASE");
    expect(restored.embedding).toBeUndefined();
  });

  it("imports a bare array and refuses anything that is not an export", () => {
    expect(parseCalibrationExport(JSON.stringify([template("YES")])).templates).toHaveLength(1);
    expect(() => parseCalibrationExport("{}")).toThrow(/not a SignRelay vocabulary export/);
    expect(() => parseCalibrationExport("not json")).toThrow(/not a SignRelay vocabulary export/);
  });

  it("does not duplicate examples when the same export is imported twice", () => {
    const raw = serialiseCalibration([template("PLEASE"), template("PLEASE")]);
    const result = parseCalibrationExport(raw);
    expect(result.templates).toHaveLength(1);
    expect(result.skipped).toBe(1);
  });
});
