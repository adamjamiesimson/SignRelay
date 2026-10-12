import { expect, test } from "vitest";

const assert = {
  deepEqual(actual, expected) { expect(actual).toEqual(expected); },
  equal(actual, expected) { expect(actual).toBe(expected); },
};
import { assessAudit } from "../scripts/audit-dependencies.mjs";

const advisory = "https://github.com/advisories/GHSA-vfj7-8cjw-p6xm";
const via = {
  braces: { name: "braces", url: advisory },
  micromatch: "braces",
  "fast-glob": "micromatch",
  "@next/eslint-plugin-next": "fast-glob",
  "eslint-config-next": "@next/eslint-plugin-next",
};

function fixtures() {
  const vulnerabilities = {};
  const packages = { "": { devDependencies: { "eslint-config-next": "16.4.0" } } };
  for (const [name, parent] of Object.entries(via)) {
    const path = `node_modules/${name}`;
    vulnerabilities[name] = { severity: "high", via: [parent], nodes: [path] };
    packages[path] = { dev: true };
  }
  return { report: { vulnerabilities }, lock: { packages } };
}

test("empty dependency audit succeeds", () => {
  const { lock } = fixtures();
  assert.deepEqual(assessAudit({ vulnerabilities: {} }, lock), { ok: true, exceptionCount: 0 });
});

test("only the explicitly reviewed GHSA dev-only chain qualifies", () => {
  const { report, lock } = fixtures();
  assert.deepEqual(assessAudit(report, lock), { ok: true, exceptionCount: 5 });
});

test("unknown advisories never inherit the exception", () => {
  const { report, lock } = fixtures();
  report.vulnerabilities.braces.via[0] = { name: "braces", url: "https://example.com/new-advisory" };
  assert.equal(assessAudit(report, lock).ok, false);
});

test("a development dependency becoming a production dependency is blocked", () => {
  const { report, lock } = fixtures();
  lock.packages["node_modules/braces"].dev = false;
  assert.equal(assessAudit(report, lock).ok, false);
});

test("unexpected dependency paths are blocked", () => {
  const { report, lock } = fixtures();
  report.vulnerabilities["fast-glob"].via = ["other-package"];
  assert.equal(assessAudit(report, lock).ok, false);
});

test("unexpected findings are blocked even when reviewed findings remain", () => {
  const { report, lock } = fixtures();
  report.vulnerabilities["some-new-package"] = { severity: "high", via: ["braces"], nodes: ["node_modules/some-new-package"] };
  lock.packages["node_modules/some-new-package"] = { dev: true };
  assert.equal(assessAudit(report, lock).ok, false);
});

test("empty node evidence cannot qualify for a dev-only exception", () => {
  const { report, lock } = fixtures();
  report.vulnerabilities.braces.nodes = [];
  assert.equal(assessAudit(report, lock).ok, false);
});
