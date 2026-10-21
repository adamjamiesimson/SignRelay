import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { capabilityStatus } from "../lib/capability-status";
import { buildDashboard } from "../scripts/evaluation-dashboard.mjs";
import { LANGUAGE_IDS } from "../lib/model-adapters";

const load = (file: string) => readFileSync(file, "utf8").trim().split("\n").map(line => JSON.parse(line));

describe("capability claims match the evidence", () => {
  it("quotes the ASL development result exactly as the dashboard computes it", () => {
    const { summary } = buildDashboard([
      { label: "development", file: "d", rows: load("docs/evaluation/asl-stroke-repair-2026-10-17/final-development.jsonl") },
      { label: "historical", file: "h", rows: load("docs/evaluation/asl-stroke-repair-2026-10-17/final-historical.jsonl") }]);
    const evidence = capabilityStatus("asl").evidence;
    expect(evidence).toContain(`On ${summary.signed_trials} previously seen`);
    expect(evidence).toContain(`${summary.correct} correct, ${summary.wrong_accepted_trials} wrong, ${summary.abstentions} no-match`);
    for (const row of summary.per_gloss) expect(evidence).toContain(`${row.gloss} ${row.correct}/${row.trials}`);
    expect(summary.per_gloss.map((row: { gloss: string }) => row.gloss)).not.toContain("SORRY");
    expect(evidence).toContain("SORRY untested");
  });
  it("describes PSL as one-shot reference matching, not a trained model", () => {
    const { headline } = capabilityStatus("psl");
    expect(headline).toMatch(/one recorded reference/);
    expect(headline).toMatch(/no trained model/i);
    expect(headline).not.toMatch(/research model/);
  });
  it.each(LANGUAGE_IDS)("%s never claims independent validation or measured live accuracy", language => {
    const status = capabilityStatus(language);
    expect(status.independentlyValidated).toBe(false);
    expect(`${status.headline} ${status.evidence}`).not.toMatch(/\d+(\.\d+)?\s*%|accura(te|cy) (is|of) \d|validated|translat(es|ion) (any|all)/i);
  });
});
