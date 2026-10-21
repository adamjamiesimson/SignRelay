import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildDashboard } from "../scripts/evaluation-dashboard.mjs";

const load = (file: string) => readFileSync(file, "utf8").trim().split("\n").map(line => JSON.parse(line));
const development = { label: "development", file: "docs/evaluation/asl-stroke-repair-2026-10-17/final-development.jsonl",
  rows: load("docs/evaluation/asl-stroke-repair-2026-10-17/final-development.jsonl") };
const historical = { label: "historical", file: "docs/evaluation/asl-stroke-repair-2026-10-17/final-historical.jsonl",
  rows: load("docs/evaluation/asl-stroke-repair-2026-10-17/final-historical.jsonl") };

describe("evaluation dashboard", () => {
  it("reproduces the recorded 5 correct / 0 wrong / 6 abstained development result with denominators", () => {
    const { markdown, summary } = buildDashboard([development, historical]);
    expect([summary.correct, summary.wrong_accepted_trials, summary.abstentions, summary.signed_errors, summary.signed_trials]).toEqual([5, 0, 6, 0, 11]);
    expect(markdown).toContain("**5 correct, 0 wrong accepted, 6 abstained, 0 errored, of 11 signed trials**");
    expect(markdown).toMatch(/\| HELLO \| \d+ \| \d+ \| 0 \|/);
  });
  it("reports absent negatives as not measured, never as zero false positives", () => {
    const { markdown } = buildDashboard([development, historical]);
    expect(markdown).toContain("No-sign activity: **not measured** — 0 trials exist");
    expect(markdown).toContain("Unsupported (out-of-vocabulary) sign: **not measured**");
    expect(markdown).not.toMatch(/0 false accepts/);
  });
  it("flags results as stale when the recognizer bundle changed", () => {
    const evaluated = development.rows[0].worker_sha256;
    expect(buildDashboard([development], { currentWorker: evaluated }).markdown).toContain("byte-identical");
    expect(buildDashboard([development], { currentWorker: "0".repeat(64) }).markdown).toContain("**Stale:**");
  });
  it("refuses raw landmark sequences and double-counted recordings", () => {
    const leaked = { ...development, rows: [{ ...development.rows[0], landmarks: [[0.1, 0.2]] }] };
    expect(() => buildDashboard([leaked])).toThrow("raw landmark/frame sequence");
    expect(() => buildDashboard([development, { ...development, label: "copy" }])).toThrow("double-counted");
  });
});
