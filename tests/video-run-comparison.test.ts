import { describe, expect, it } from "vitest";
import { compareVideoRuns, renderReport } from "../scripts/compare-video-runs.mjs";

const sample = (fixture_id: string, predicted_gloss: string | null, outcome: string, frames: number) => ({
  fixture_id, expected_gloss: "HELLO", trial_type: "sign", source_file: "hello.mp4",
  notes: "sha256=identical", predicted_gloss, outcome,
  pipeline: { workerFrames: frames },
});

describe("two-run video replay comparison", () => {
  it("reports same fixtures with variable frames but stable sign outcomes", () => {
    const result = compareVideoRuns([sample("one", null, "rejected", 11)],
      [sample("one", null, "rejected", 15)]);
    expect(result.changed).toBe(0);
    expect(result.totalWorkerA).toBe(11);
    expect(result.totalWorkerB).toBe(15);
    expect(renderReport(result)).toContain("0 of 1 fixtures");
  });
  it("flags changes from rejected to false labels", () => {
    const result = compareVideoRuns([sample("one", null, "rejected", 12)],
      [sample("one", "THANK YOU", "wrong", 13)]);
    expect(result.changedIds).toEqual(["one"]);
    expect(renderReport(result)).toContain("THANK YOU (wrong)");
  });
  it("refuses comparisons with different fixture membership or source fingerprints", () => {
    expect(() => compareVideoRuns([sample("a", null, "rejected", 2)],
      [sample("b", null, "rejected", 2)])).toThrow(/same fixture IDs/);
    expect(() => compareVideoRuns([sample("a", null, "rejected", 2)],
      [{ ...sample("a", null, "rejected", 2), notes: "sha256=different" }])).toThrow(/provenance changed/);
  });
});
