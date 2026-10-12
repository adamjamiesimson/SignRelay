import { describe, expect, it } from "vitest";
import { coverage, diagnosePairs, renderTrackingTriage } from "../scripts/diagnose-asl-tracking.mjs";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

function fixture(id: number, expected: string | null, predicted: string | null, handFrames: number, outcome?: string) {
  return {
    fixture_id: "fixture-" + id,
    language: "asl",
    trial_type: expected ? "sign" : "no_sign",
    expected_gloss: expected,
    predicted_gloss: predicted,
    accepted: predicted !== null,
    outcome: outcome ?? (expected === null ? predicted ? "false_accept" : "correct_reject" :
      predicted === expected ? "correct" : predicted === null ? "rejected" : "wrong"),
    source_file: "video-" + id + ".mp4",
    notes: "sha256=" + String(id).padStart(64, "0"),
    participant_id: "signer-" + id,
    device: "source-smartphone", condition: "front",
    frame_mode: "source-frames-only",
    tracker: { hand_coverage: handFrames / 10 },
    pipeline: { workerFrames: 10, workerHandFrames: handFrames, candidateSources: { starter: 3 }, faults: 0, modelProblemAnalyses: 0 },
  };
}

describe("read-only paired ASL tracking triage", () => {
  it("marks low worker coverage separately from sampled UI coverage", () => {
    const a = fixture(1, "YES", null, 2);
    const b = { ...a, tracker: { hand_coverage: 0.8 } };
    expect(coverage(b)).toEqual({ worker: 0.2, ui: 0.8, workerFrames: 10 });
    const report = diagnosePairs([a], [b]);
    expect(report.lowHand).toBe(1);
    expect(report.rows[0].observations).toContain("low-worker-hand-coverage");
    expect(renderTrackingTriage(report)).toContain("20.0% / 20.0%");
  });
  it("identifies reproducible THANK YOU -> PLEASE and unstable HELLO -> PLEASE", () => {
    const thankyou = fixture(1, "THANK YOU", "PLEASE", 5);
    const hello = fixture(2, "HELLO", "PLEASE", 7);
    const bHello = fixture(2, "HELLO", null, 7);
    const report = diagnosePairs([thankyou, hello], [thankyou, bHello]);
    expect(report.wrongPlease).toBe(2);
    expect(report.unstable).toBe(1);
    expect(report.rows[0].observations).toContain("wrong-PLEASE");
    const markdown = renderTrackingTriage(report);
    expect(markdown).toContain("THANK YOU");
    expect(markdown).toContain("candidate-source counter");
    expect(markdown).toContain("starter: 3");
  });
  it("attributes wrong PLEASE to the worker-confirmed origin instead of candidate counters", () => {
    const left = fixture(7, "THANK YOU", "PLEASE", 8);
    left.pipeline.confirmedEvents = [{ gloss: "PLEASE", source: "starter", ms: 420 }];
    const right = { ...left, pipeline: { ...left.pipeline, confirmedEvents: [{ gloss: "PLEASE", source: "model", ms: 480 }] } };
    const result = diagnosePairs([left], [right]);
    expect(result.rows[0].confirmedSources).toEqual({ a: "starter", b: "model" });
    expect(renderTrackingTriage(result)).toContain("starter / model");
    const mismatched = { ...left, pipeline: { ...left.pipeline, confirmedEvents: [{ gloss: "HELLO", source: "starter", ms: 420 }] } };
    expect(diagnosePairs([mismatched], [right]).rows[0].confirmedSources.a).toBe("unknown");
  });
  it("does not label valid PLEASE or no-sign controls as false PLEASE", () => {
    const please = fixture(1, "PLEASE", "PLEASE", 9);
    const idle = fixture(2, null, null, 6);
    const report = diagnosePairs([please, idle], [please, idle]);
    expect(report.wrongPlease).toBe(0);
    expect(report.lowHand).toBe(0);
    expect(report.unstable).toBe(0);
  });
  it("preserves missing worker coverage rather than pretending it is zero", () => {
    const row = fixture(1, "HELLO", null, 2);
    const missing = { ...row, pipeline: { workerFrames: 0, workerHandFrames: 0 } };
    expect(coverage(missing).worker).toBeNull();
    const r = diagnosePairs([missing], [missing]);
    expect(r.missingHand).toBe(1);
    expect(r.lowHand).toBe(0);
    expect(renderTrackingTriage(r)).toContain("n/a / n/a");
  });
  it("flags model issues and errors with adequate hand presence", () => {
    const row = fixture(1, "PLEASE", null, 9);
    const other = { ...row, pipeline: { ...row.pipeline, modelProblemAnalyses: 1 } };
    const report = diagnosePairs([row], [other]);
    expect(report.rows[0].observations).toContain("worker-or-model-problem");
    expect(report.rows[0].observations).toContain("failure-with-hands-observed");
  });
  it("rejects mismatched signer/source identities using the existing manifest integrity guard", () => {
    const row = fixture(1, "HELLO", null, 2);
    expect(() => diagnosePairs([row], [{ ...row, participant_id: "other-signer" }])).toThrow(/participant_id/);
  });
  it("runs the workflow CLI on JSONL and writes only a derived Markdown report", () => {
    const dir = mkdtempSync(join(tmpdir(), "signrelay-triage-"));
    try {
      const a = join(dir, "a.jsonl"), b = join(dir, "b.jsonl"), out = join(dir, "triage.md");
      const rowA = fixture(1, "HELLO", "PLEASE", 7);
      const rowB = fixture(1, "HELLO", null, 7);
      writeFileSync(a, JSON.stringify(rowA) + "\n");
      writeFileSync(b, JSON.stringify(rowB) + "\n");
      const runner = fileURLToPath(new URL("../scripts/diagnose-asl-tracking.mjs", import.meta.url));
      const result = spawnSync(process.execPath, [runner, a, b, out], { encoding: "utf8" });
      expect(result.status).toBe(0);
      const markdown = readFileSync(out, "utf8");
      expect(markdown).toContain("wrong-PLEASE");
      expect(markdown).toContain("HELLO");
      expect(markdown).not.toContain('"x":');
      expect(markdown).not.toContain("<video");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
