import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildReport, reportMarkdown } from "../scripts/evaluation-report.mjs";

const json = (file: string) => JSON.parse(readFileSync(file, "utf8"));
const inputs = () => ({ baseline: json("docs/evaluation/established-baseline.json"), runtimes: json("docs/evaluation/evaluated-runtimes.json").runtimes,
  currentWorker: "ccce84c876f95caf9cade9a93fad1b686d5009a77ada203049044ee17ceb5632", adversarial: json("docs/gitex/adversarial-inventory.json"),
  confusion: json("docs/gitex/sprint-2/confusion-matrix.json"), temporal: json("docs/gitex/sprint-2/temporal-stress.json"),
  experiments: json("docs/gitex/sprint-2/experiments.json"), risks: json("docs/gitex/known-false-accept-risks.json") });

describe("evaluation and triage report", () => {
  it("is NO-GO, reproduces 5/0/6 and ranks blockers first", () => {
    const report = buildReport(inputs());
    expect(report.release_status).toBe("NO-GO");
    expect(report.real_video).toMatchObject({ trials: 11, correct: 5, wrong: 0, abstained: 6 });
    expect(report.real_video.per_sign.SORRY).toEqual({ trials: 0, correct: 0, wrong: 0, abstained: 0 });
    expect(report.triage[0].severity).toBe("blocker");
    const order = report.triage.map((issue: { severity: string }) => ["blocker", "high", "medium", "low"].indexOf(issue.severity));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(report.triage.map((issue: { title: string }) => issue.title)).toEqual(expect.arrayContaining([
      "SORRY has no real-video trial", "THANK YOU is never recognized on development clips", "Real no-sign and out-of-vocabulary false acceptance is not measured"]));
  });
  it("raises a blocker when the current worker has no real-video evidence or the gate fails", () => {
    const report = buildReport({ ...inputs(), currentWorker: "0".repeat(64), gateResult: { ok: false, failures: ["NEW WRONG ACCEPTANCE on x"], changes: [] } });
    const blockers = report.triage.filter((issue: { severity: string }) => issue.severity === "blocker").map((issue: { title: string }) => issue.title);
    expect(blockers).toEqual(expect.arrayContaining(["Current worker has no real-video evidence", "Candidate run fails the established-baseline gate"]));
  });
  it("never presents synthetic records as accuracy or a percentage", () => {
    const markdown = reportMarkdown(buildReport(inputs()));
    expect(markdown).toContain("Synthetic regression records (not accuracy)");
    expect(markdown).not.toMatch(/\d+(\.\d+)?\s?%/);
  });
});
