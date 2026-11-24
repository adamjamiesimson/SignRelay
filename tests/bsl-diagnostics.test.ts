import { describe, expect, it } from "vitest";
import { bslHint, describeBslDecision, emptyBslDiagnostics, formatBslDiagnostics } from "../lib/bsl-diagnostics";

const policy = { minTop1: 0.82, minMargin: 0.14, minHandFrames: 8 };
const base = { best: "HELLO", top5: [{ label: "HELLO", p: 0.9 }, { label: "HI", p: 0.05 }], pTop1: 0.9, margin: 0.85,
  windows: 2, spanFrames: 20, handFrames: 14, slotDisagreements: 1, inferenceMs: 70 };
const ui = { received: 0, ignored: 0, shown: 0, added: 0, spoken: 0 };

describe("BSL ?perf diagnostics", () => {
  it("explains each rejection in the order the policy applies it", () => {
    expect(describeBslDecision(base, policy)).toMatchObject({ status: "accepted", reason: "" });
    expect(describeBslDecision({ ...base, windows: 0 }, policy).status).toBe("no-movement");
    expect(describeBslDecision({ ...base, handFrames: 3 }, policy)).toMatchObject({ status: "too-few-hands", reason: expect.stringContaining("3 hand frames") });
    expect(describeBslDecision({ ...base, pTop1: 0.5 }, policy)).toMatchObject({ status: "uncertain", reason: expect.stringContaining("0.50 < 0.82") });
    expect(describeBslDecision({ ...base, margin: 0.1 }, policy)).toMatchObject({ status: "uncertain", reason: expect.stringContaining("margin") });
  });

  it("points the tester at the first stage that is not working", () => {
    const d = emptyBslDiagnostics();
    expect(bslHint(d, ui, 0)).toContain("No camera frames");
    Object.assign(d, { observations: 40, handFrames: 0 });
    expect(bslHint(d, ui, 40)).toContain("No hands");
    Object.assign(d, { handFrames: 30, shoulderFrames: 0 });
    expect(bslHint(d, ui, 40)).toContain("Shoulders");
    Object.assign(d, { shoulderFrames: 30 });
    expect(bslHint(d, ui, 40)).toContain("No completed sign");
    Object.assign(d, { signsCompleted: 2, model: "ready", inferences: 2, lastDecision: { ...describeBslDecision({ ...base, pTop1: 0.4 }, policy), ageMs: 0 } });
    expect(bslHint(d, ui, 40)).toContain("not confident");
    d.decisions.accepted = 1; d.suggestionsPosted = 1;
    expect(bslHint(d, { ...ui, received: 1 }, 40)).toContain("Add to transcript");
  });

  it("formats a readable stage report with no landmark data", () => {
    const d = { ...emptyBslDiagnostics(), observations: 10, lastDecision: { ...describeBslDecision(base, policy), ageMs: 2000 } };
    const lines = formatBslDiagnostics(d, ui, 12);
    expect(lines[0]).toContain("BSL v2");
    expect(lines.join("\n")).toContain("HELLO 0.90");
    expect(lines.join("\n")).toContain("2 windows");
    expect(lines.at(-1)).toMatch(/^Next step:/);
  });
});
