import { describe, expect, it } from "vitest";
import { BROWSER_SMOKES, CHECKS, compareReports, parseVitest, runCheck } from "../scripts/readiness.mjs";

describe("readiness report", () => {
  it("parses vitest totals including failures", () => {
    expect(parseVitest(" Test Files  69 passed (69)\n      Tests  678 passed (678)"))
      .toEqual({ test_files: 69, test_files_failed: 0, tests: 678, tests_failed: 0, tests_passed: 678 });
    expect(parseVitest(" Test Files  1 failed | 68 passed (69)\n      Tests  2 failed | 676 passed (678)"))
      .toMatchObject({ test_files_failed: 1, tests_failed: 2, tests: 678 });
  });
  it("records a failing command with its real exit code instead of hiding it", () => {
    const fake = () => ({ status: 1, stdout: "", stderr: "5 high severity vulnerabilities" });
    const result = runCheck({ id: "strict-audit", category: "security-release-gate", command: ["npm", "run", "audit:security"] }, fake as never);
    expect(result).toMatchObject({ passed: false, exit_code: 1, category: "security-release-gate" });
    expect(result.tail.join(" ")).toContain("5 high");
  });
  it("keeps the strict audit as its own release-gate category", () => {
    expect(CHECKS.find(check => check.id === "strict-audit")?.category).toBe("security-release-gate");
    expect(CHECKS.filter(check => check.category === "security-release-gate")).toHaveLength(1);
  });
  it("flags regressions, fixes and lost tests between two reports", () => {
    const base = { checks: [{ id: "lint", passed: true }, { id: "strict-audit", passed: false }, { id: "unit-tests", passed: true, summary: { tests: 678 } }] };
    const now = { checks: [{ id: "lint", passed: false }, { id: "strict-audit", passed: true }, { id: "unit-tests", passed: true, summary: { tests: 600 } }] };
    expect(compareReports(base, now)).toEqual([{ id: "lint", change: "regression" }, { id: "strict-audit", change: "fixed" },
      { id: "unit-tests", change: "fewer-tests", before: 678, after: 600 }]);
  });
});

describe("release decision", () => {
  it("is NO-GO with every pending manual gate listed, even when the strict gate passes", async () => {
    const { releaseDecision } = await import("../scripts/readiness.mjs");
    const gates = [{ id: "MAN-1", requirement: "sign on the real webcam" }, { id: "MAN-2", requirement: "rest hands" }];
    const decision = releaseDecision({ strictPassed: true, manualGates: gates });
    expect(decision.status).toBe("NO-GO");
    expect(decision.reasons.filter((reason: string) => reason.startsWith("Manual gate"))).toHaveLength(2);
    expect(releaseDecision({ strictPassed: false, manualGates: [] }).reasons[0]).toContain("Strict dependency release gate fails");
  });
  it("runs the rehearsal and strict offline suites for their own builds", () => {
    expect(BROWSER_SMOKES.rehearsal).toEqual(["gitex-rehearsal-smoke", "transcript-a11y-smoke"]);
    expect(BROWSER_SMOKES["asl-demo"]).toContain("offline-demo-strict-smoke");
    expect(BROWSER_SMOKES.full).toContain("workspace-browser-smoke");
  });
});
