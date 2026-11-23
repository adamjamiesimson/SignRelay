import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { appendTrial, resultsPath, sessionInfo, trialRow } from "../scripts/live-trial-log.mjs";
import { summarizeLive } from "../scripts/summarize-live-evaluation.mjs";

const session = sessionInfo({ sessionId: "S01", participantId: "P01", device: "laptop webcam", condition: "indoor bright", framesPerSecond: "12.5", worker: "abc" });
const at = "2026-10-21T12:00:00.000Z";
const dirs: string[] = [];
// Inside the git-ignored results folder, so a crashed run leaves nothing committable.
const scratch = () => { mkdirSync("evaluation/results", { recursive: true }); const dir = mkdtempSync(join(resolve("evaluation/results"), ".test-")); dirs.push(dir); return dir; };
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("live trial rows", () => {
  it("record each operator outcome in the evaluation JSONL format, marked unreviewed", () => {
    expect(trialRow(session, { index: 1, attempted: "HELLO", outcome: "correct", observedAt: at })).toMatchObject({
      trial_id: "S01-001", participant_id: "P01", language: "asl", trial_type: "sign", expected_gloss: "HELLO",
      predicted_gloss: "HELLO", accepted: true, accepted_glosses: ["HELLO"], status: "complete", evaluation_split: "development",
      frames_analysed_per_s: 12.5, recognition_worker_sha256: "abc", review: { status: "unreviewed" }, source: "operator-live-log" });
    expect(trialRow(session, { index: 2, attempted: "THANK YOU", outcome: "wrong", shown: "thank you, hello" }))
      .toMatchObject({ accepted_glosses: ["THANK YOU", "HELLO"], predicted_gloss: "THANK YOU", accepted: true });
    expect(trialRow(session, { index: 3, attempted: "YES", outcome: "no_match" })).toMatchObject({ accepted: false, predicted_gloss: null, accepted_glosses: [] });
    expect(trialRow(session, { index: 4, attempted: "NO", outcome: "failure", failure: "camera unplugged" }))
      .toMatchObject({ status: "error", errors: ["camera unplugged"], accepted: false });
    expect(trialRow(session, { index: 5, attempted: "no_sign", outcome: "wrong", shown: "Hello" }))
      .toMatchObject({ trial_type: "no_sign", expected_gloss: null, accepted_glosses: ["HELLO"] });
  });

  it("refuses contradictory or identifying input", () => {
    expect(() => trialRow(session, { index: 1, attempted: "no_sign", outcome: "correct" })).toThrow(/cannot be 'correct'/);
    expect(() => trialRow(session, { index: 1, attempted: "HELLO", outcome: "wrong", shown: "hello" })).toThrow(/record 'correct'/);
    expect(() => trialRow(session, { index: 1, attempted: "HELLO", outcome: "wrong" })).toThrow(/word or words/);
    expect(() => trialRow(session, { index: 1, attempted: "HELLO", outcome: "failure" })).toThrow(/describe/);
    expect(() => trialRow(session, { index: 1, attempted: "GOODBYE", outcome: "correct" })).toThrow(/attempted sign/);
    expect(() => trialRow(session, { index: 1, attempted: "HELLO", outcome: "correct", note: "ask jane@example.org" })).toThrow(/e-mail/);
    expect(() => sessionInfo({ sessionId: "S01", participantId: "Jane Doe", device: "", condition: "" })).toThrow(/pseudonym/);
    expect(() => sessionInfo({ sessionId: "S01", participantId: "P01", device: "", condition: "", framesPerSecond: "fast" })).toThrow(/frames/);
  });

  it("only writes inside the git-ignored results folder", () => {
    expect(resultsPath(undefined, "S01")).toMatch(/evaluation\/results\/live-\d{4}-\d{2}-\d{2}-S01\.jsonl$/);
    expect(() => resultsPath("docs/live.jsonl", "S01")).toThrow(/git-ignored/);
    expect(() => resultsPath("evaluation/results/../../docs/live.jsonl", "S01")).toThrow(/git-ignored/);
    expect(() => resultsPath("evaluation/results/live.txt", "S01")).toThrow(/\.jsonl/);
    expect(readFileSync(".gitignore", "utf8")).toMatch(/^\/evaluation\/results\/$/m);
  });
});

describe("appending trials", () => {
  it("validates the whole file, refuses duplicates and leaves no temporary file", () => {
    const path = join(scratch(), "live.jsonl");
    expect(appendTrial(path, trialRow(session, { index: 1, attempted: "HELLO", outcome: "correct" }))).toBe(1);
    expect(appendTrial(path, trialRow(session, { index: 2, attempted: "SORRY", outcome: "no_match" }))).toBe(2);
    expect(() => appendTrial(path, trialRow(session, { index: 2, attempted: "PLEASE", outcome: "correct" }))).toThrow(/duplicate trial_id/);
    const lines = readFileSync(path, "utf8").trim().split("\n").map(line => JSON.parse(line));
    expect(lines.map(row => row.trial_id)).toEqual(["S01-001", "S01-002"]);
    expect(readdirSync(join(path, "..")).filter(name => name.endsWith(".tmp"))).toEqual([]);
  });

  it("refuses to add to a file that is already invalid", () => {
    const path = join(scratch(), "live.jsonl");
    writeFileSync(path, JSON.stringify({ trial_id: "x" }) + "\n");
    expect(() => appendTrial(path, trialRow(session, { index: 1, attempted: "HELLO", outcome: "correct" }))).toThrow(/missing/);
    expect(readFileSync(path, "utf8")).toBe(JSON.stringify({ trial_id: "x" }) + "\n");
  });
});

describe("summaries keep operator observations apart", () => {
  it("never mixes unreviewed operator rows into the reviewed groups", () => {
    const reviewedRow = { session_id: "R1", participant_id: "R01", language: "asl", trial_type: "sign", expected_gloss: "HELLO", predicted_gloss: "HELLO", accepted: true };
    const summary = summarizeLive([reviewedRow, trialRow(session, { index: 1, attempted: "HELLO", outcome: "wrong", shown: "NO" })]);
    expect(summary.groups).toHaveLength(1);
    expect(JSON.stringify(summary.groups)).not.toContain("NO");
    expect(summary.unreviewed_operator_observations?.note).toMatch(/not accuracy/);
    expect(summary.unreviewed_operator_observations?.groups).toHaveLength(1);
    expect(summarizeLive([reviewedRow]).unreviewed_operator_observations).toBeUndefined();
  });
});

describe("interactive operator log", () => {
  it("runs a session from piped input and writes rows that eval:live can summarise", () => {
    const dir = scratch();
    const out = join(dir, "session.jsonl");
    const input = ["S07", "P03", "demo laptop webcam", "indoor bright", "11",
      "1", "c", "", // HELLO correct
      "2", "w", "thank you, hello", "tail word", // THANK YOU + extra
      "n", "m", "", // no-sign, nothing appeared
      "9", // invalid choice, re-asked
      "5", "f", "tracking froze", "",
      "q"].join("\n") + "\n";
    const result = spawnSync("node", ["scripts/live-trial-log.mjs", "--out", out], { input, encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Do not publish them as accuracy");
    const rows = readFileSync(out, "utf8").trim().split("\n").map(line => JSON.parse(line));
    expect(rows.map(row => [row.trial_id, row.trial_type, row.operator_outcome])).toEqual([
      ["S07-001", "sign", "correct"], ["S07-002", "sign", "wrong"], ["S07-003", "no_sign", "no_match"], ["S07-004", "sign", "failure"]]);
    const summary = spawnSync("node", ["scripts/summarize-live-evaluation.mjs", out], { encoding: "utf8" });
    expect(summary.status, summary.stderr).toBe(0);
    expect(JSON.parse(summary.stdout).unreviewed_operator_observations.groups).toHaveLength(1);
    expect(existsSync(`${out}.tmp`)).toBe(false);
  });
});
