import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildDashboard, COHORT_LOCK } from "../scripts/evaluation-dashboard.mjs";

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

describe("evaluation provenance", () => {
  const cohortLock = JSON.parse(readFileSync(COHORT_LOCK, "utf8"));
  const runtimes = JSON.parse(readFileSync("docs/evaluation/evaluated-runtimes.json", "utf8")).runtimes;
  const sealed = cohortLock.manifests.find((manifest: { role: string }) => manifest.role === "sealed-holdout").sha256;
  const patched = (patch: object) => ({ ...development, rows: development.rows.map(row => ({ ...row, ...patch })) });
  it("refuses to add results from different recognition workers together", () => {
    expect(() => buildDashboard([development, patched({ worker_sha256: "1".repeat(64), recording_sha256: undefined })]))
      .toThrow("different recognition workers");
    expect(() => buildDashboard([patched({ worker_sha256: undefined })])).toThrow("no worker_sha256");
  });
  it("refuses sealed-holdout, unknown-cohort and other-vocabulary evidence", () => {
    expect(() => buildDashboard([patched({ manifest_sha256: sealed })], { cohortLock })).toThrow("sealed-holdout evidence must never");
    expect(() => buildDashboard([patched({ manifest_sha256: "2".repeat(64) })], { cohortLock })).toThrow("not in the cohort lock");
    expect(() => buildDashboard([patched({ vocabulary_sha256: "3".repeat(64) })], { cohortLock })).toThrow("differs from the locked vocabulary");
  });
  it("names each source's cohort role and leads with staleness, citing separate evidence for the current worker", () => {
    const current = runtimes[1].worker_sha256;
    const { markdown } = buildDashboard([development, historical], { cohortLock, currentWorker: current, evaluatedRuntimes: runtimes });
    expect(markdown.split("\n")[2]).toMatch(/^> \*\*Stale:\*\*/);
    expect(markdown).toContain("Separate evidence for the current worker");
    expect(markdown).toContain("| historical-development |");
    expect(buildDashboard([development], { currentWorker: "4".repeat(64), evaluatedRuntimes: runtimes }).markdown).toContain("Re-run the video pilot");
  });
  it("the committed dashboard matches its sources and the committed worker (regenerate it when either changes)", () => {
    const currentWorker = createHash("sha256").update(readFileSync("public/workers/recognition.worker.js")).digest("hex");
    const { markdown } = buildDashboard([development, historical], { currentWorker, cohortLock, evaluatedRuntimes: runtimes });
    expect(readFileSync("docs/evaluation/dashboard-2026-10-21.md", "utf8")).toBe(markdown + "\n");
  });
});
