import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BASELINE, EXPLANATIONS, freezeBaseline, gate } from "../scripts/baseline-gate.mjs";

const load = (file: string) => readFileSync(file, "utf8").trim().split("\n").map(line => JSON.parse(line));
const rows = [...load("docs/evaluation/asl-stroke-repair-2026-10-17/final-development.jsonl"), ...load("docs/evaluation/asl-stroke-repair-2026-10-17/final-historical.jsonl")];
const baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
const explanations = JSON.parse(readFileSync(EXPLANATIONS, "utf8"));
const lock = JSON.parse(readFileSync("docs/evaluation/cohort-lock-2026-10-16.json", "utf8"));
const NEW_WORKER = "9".repeat(64);
const candidate = (patch: Record<string, object> = {}, worker = NEW_WORKER) =>
  rows.map(row => ({ ...row, worker_sha256: worker, ...(patch[row.trial_id] ?? {}) }));

describe("established-baseline regression gate", () => {
  it("the committed baseline is exactly the frozen committed JSONL: 5 correct, 0 wrong, 6 abstained of 11", () => {
    expect(freezeBaseline(rows, lock).trials).toEqual(baseline.trials);
    expect(baseline.summary).toEqual({ trials: 11, correct: 5, wrong: 0, abstained: 6 });
    expect(explanations.changes).toEqual([]);
  });
  it("passes an identical re-run of the established and reproducing workers", () => {
    expect(gate(baseline, rows, explanations, lock)).toMatchObject({ ok: true, changes: [] });
    expect(gate(baseline, candidate({}, baseline.reproduced_by_workers[0]), explanations, lock).ok).toBe(true);
  });
  it("fails on a new wrong acceptance even when it is explained", () => {
    const wrong = candidate({ "dev-hello-4a.8006": { accepted_glosses: ["THANK YOU"] } });
    const excuse = { changes: [{ trial_id: "dev-hello-4a.8006", to: "wrong", candidate_worker_sha256: NEW_WORKER, explanation: "accepted" }] };
    const result = gate(baseline, wrong, excuse, lock);
    expect(result.ok).toBe(false);
    expect(result.failures[0]).toContain("NEW WRONG ACCEPTANCE on dev-hello-4a.8006: HELLO -> THANK YOU");
  });
  it("fails on a lost correct outcome unless that exact change is explained for that worker", () => {
    const lost = candidate({ "hello-gtsignstudy4a.8033": { accepted_glosses: [] } });
    expect(gate(baseline, lost, explanations, lock).failures).toEqual([expect.stringContaining("hello-gtsignstudy4a.8033: lost_correct (correct -> abstained) needs an entry")]);
    const reason = { trial_id: "hello-gtsignstudy4a.8033", to: "abstained", candidate_worker_sha256: NEW_WORKER, explanation: "Reviewed: the clip's HELLO is a regional variant." };
    expect(gate(baseline, lost, { changes: [reason] }, lock)).toMatchObject({ ok: true, explained: [expect.objectContaining({ kind: "lost_correct" })] });
    expect(gate(baseline, lost, { changes: [{ ...reason, candidate_worker_sha256: "8".repeat(64) }] }, lock).ok).toBe(false);
    expect(gate(baseline, lost, { changes: [{ ...reason, explanation: " " }] }, lock).ok).toBe(false);
  });
  it("flags a changed abstention — even a gain — until it is explained", () => {
    const gained = candidate({ "dev-yes-4a.8006": { accepted_glosses: ["YES"] } });
    const result = gate(baseline, gained, explanations, lock);
    expect(result.ok).toBe(false);
    expect(result.changes).toEqual([expect.objectContaining({ trial_id: "dev-yes-4a.8006", kind: "abstention_to_correct" })]);
  });
  it("treats any change under the established worker as nondeterminism", () => {
    const flipped = rows.map(row => row.trial_id === "dev-no-4a.8030" ? { ...row, accepted_glosses: [] } : row);
    expect(gate(baseline, flipped, explanations, lock).failures[0]).toContain("nondeterministic evaluation");
  });
  it("requires every baseline trial, complete, from one worker, and refuses unknown or sealed recordings", () => {
    expect(gate(baseline, candidate().slice(1), explanations, lock).failures[0]).toContain("Missing");
    expect(gate(baseline, candidate({ "dev-no-4a.8030": { status: "error" } }), explanations, lock).failures[0]).toContain("a failure is never an abstention");
    const mixed = candidate().map((row, i) => i ? row : { ...row, worker_sha256: "7".repeat(64) });
    expect(gate(baseline, mixed, explanations, lock).failures[0]).toContain("2 workers");
    const extra = [...candidate(), { ...candidate()[0], trial_id: "new", recording_sha256: "6".repeat(64) }];
    expect(gate(baseline, extra, explanations, lock).failures.join("\n")).toContain("not in the established baseline");
    const sealed = lock.manifests.find((m: { role: string }) => m.role === "sealed-holdout").sha256;
    expect(() => gate(baseline, candidate({ "dev-no-4a.8030": { manifest_sha256: sealed } }), explanations, lock)).toThrow("sealed-holdout");
  });
});

describe("baseline gate wiring", () => {
  it("runs in the paired video pilot without a masked exit status", () => {
    const workflow = readFileSync(".github/workflows/asl-video-pilot.yml", "utf8");
    const step = workflow.slice(workflow.indexOf("Gate against the exact established baseline"));
    expect(step).toContain("set -o pipefail");
    expect(step).toContain("node scripts/baseline-gate.mjs");
    expect(step).not.toContain("continue-on-error");
    expect(workflow).toContain("'scripts/baseline-gate.mjs'");
  });
});
