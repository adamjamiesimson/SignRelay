import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { evaluateAudit } from "../scripts/audit-dependencies.mjs";

const committed = JSON.parse(readFileSync("docs/security/dependency-exceptions.json", "utf8"));
// The 2026-10-21 review of the braces chain, kept as a fixture so the gate's
// fail-closed rules stay tested after the chain was removed from the lockfile.
const exceptions = {
  ...committed,
  exceptions: [{
    advisory: "GHSA-vfj7-8cjw-p6xm", package: "braces", range: "<=3.0.3", scope: "development",
    chain: ["micromatch", "fast-glob", "@next/eslint-plugin-next", "eslint-config-next"],
    reason: "Development-only lint tooling; no patched braces release.", reviewed_on: "2026-10-21", expires: "2026-11-30",
  }],
};
const advisory = (name: string, id: string, severity = "high") => ({
  name, severity, isDirect: false, effects: [],
  via: [{ name, url: `https://github.com/advisories/${id}`, severity, title: "test", range: "*" }],
});
const chainLink = (name: string, via: string) => ({ name, severity: "high", isDirect: false, via: [via], effects: [] });
const braces = { vulnerabilities: {
  braces: advisory("braces", "GHSA-vfj7-8cjw-p6xm"), micromatch: chainLink("micromatch", "braces"),
  "fast-glob": chainLink("fast-glob", "micromatch"), "@next/eslint-plugin-next": chainLink("@next/eslint-plugin-next", "fast-glob"),
  "eslint-config-next": chainLink("eslint-config-next", "@next/eslint-plugin-next"),
} };
const clean = { vulnerabilities: {} };

describe("fail-closed dependency gate", () => {
  it("accepts only the reviewed development braces chain before it expires", () => {
    const result = evaluateAudit({ full: braces, production: clean, exceptions, today: "2026-10-21" });
    expect(result.ok).toBe(true);
    expect(result.accepted.map(item => item.advisory)).toEqual(["GHSA-vfj7-8cjw-p6xm"]);
  });
  it("fails once the review expires", () => {
    const result = evaluateAudit({ full: braces, production: clean, exceptions, today: "2026-12-01" });
    expect(result.ok).toBe(false);
    expect(result.failures.join("\n")).toContain("expired");
  });
  it("never accepts the same advisory in production dependencies", () => {
    const result = evaluateAudit({ full: braces, production: braces, exceptions, today: "2026-10-21" });
    expect(result.ok).toBe(false);
    expect(result.failures[0]).toContain("Production dependency advisory GHSA-vfj7-8cjw-p6xm");
  });
  it("fails on any new development advisory, such as the vite launch-editor findings", () => {
    const full = { vulnerabilities: { ...braces.vulnerabilities, vite: advisory("vite", "GHSA-r825-w8mm-5pxw") } };
    const result = evaluateAudit({ full, production: clean, exceptions, today: "2026-10-21" });
    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([expect.stringContaining("Unreviewed development advisory GHSA-r825-w8mm-5pxw in vite")]);
  });
  it("fails when a vulnerable package is not explained by a reviewed chain", () => {
    const full = { vulnerabilities: { ...braces.vulnerabilities, other: chainLink("other", "unknown") } };
    expect(evaluateAudit({ full, production: clean, exceptions, today: "2026-10-21" }).failures)
      .toEqual([expect.stringContaining("other is not explained")]);
  });
  it("reports a stale exception after the advisory disappears", () => {
    const result = evaluateAudit({ full: clean, production: clean, exceptions, today: "2026-10-21" });
    expect(result.ok).toBe(true);
    expect(result.stale).toHaveLength(1);
  });
});

describe("reviewed exceptions cannot be widened", () => {
  const base = exceptions;
  const withException = (patch: object) => ({ ...base, exceptions: [{ ...base.exceptions[0], ...patch }] });
  it.each([
    [{ scope: "production" }, "scoped to development"],
    [{ reason: "" }, "lacks reason"],
    [{ expires: "someday" }, "expired"],
    [{ advisory: "GHSA-xxxx-xxxx-xxxx" }, "Unreviewed development advisory"],
  ])("fails closed for a malformed or unapproved exception %#", (patch, message) => {
    const result = evaluateAudit({ full: braces, production: clean, exceptions: withException(patch), today: "2026-10-21" });
    expect(result.ok).toBe(false);
    expect(result.failures.join("\n")).toContain(message);
  });
  it("no development exception is committed once the braces chain is gone", () => {
    expect(committed.exceptions).toEqual([]);
  });
});
