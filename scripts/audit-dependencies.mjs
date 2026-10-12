import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ADVISORY_URL = "https://github.com/advisories/GHSA-vfj7-8cjw-p6xm";
const REVIEWED_CHAIN = new Map([
  ["braces", ADVISORY_URL],
  ["micromatch", "braces"],
  ["fast-glob", "micromatch"],
  ["@next/eslint-plugin-next", "fast-glob"],
  ["eslint-config-next", "@next/eslint-plugin-next"],
]);

// This is a narrow, review-required exception for a *development-only*
// advisory without a published fix. It does not disable or filter npm audit.
export function assessAudit(report, lock) {
  if (!report || typeof report !== "object" || !report.vulnerabilities ||
      typeof report.vulnerabilities !== "object" || !lock?.packages) {
    return { ok: false, reason: "Missing or invalid npm audit / lockfile data." };
  }
  const findings = Object.entries(report.vulnerabilities);
  if (findings.length === 0) return { ok: true, exceptionCount: 0 };

  if (findings.length !== REVIEWED_CHAIN.size ||
      !lock.packages[""]?.devDependencies?.["eslint-config-next"]) {
    return { ok: false, reason: "Unexpected vulnerability count or lint dependency tree." };
  }

  for (const [name, vulnerability] of findings) {
    const expected = REVIEWED_CHAIN.get(name);
    if (!expected || vulnerability?.severity !== "high" ||
        !Array.isArray(vulnerability.via) || vulnerability.via.length !== 1) {
      return { ok: false, reason: `Unreviewed advisory or severity in ${name}.` };
    }
    const via = vulnerability.via[0];
    const matchesVia = name === "braces"
      ? typeof via === "object" && via?.name === "braces" && via?.url === expected
      : via === expected;
    if (!matchesVia) {
      return { ok: false, reason: `Unexpected vulnerability path for ${name}.` };
    }

    const nodes = vulnerability.nodes;
    if (!Array.isArray(nodes) || nodes.length === 0 ||
        nodes.some((path) =>
          typeof path !== "string" ||
          !(path === `node_modules/${name}` || path.endsWith(`/node_modules/${name}`)) ||
          lock.packages[path]?.dev !== true
        )) {
      return { ok: false, reason: `${name} is not proven development-only in package-lock.json.` };
    }
  }
  return { ok: true, exceptionCount: findings.length };
}

function npmAudit(extraArgs = []) {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(npm, ["audit", "--json", "--audit-level=moderate", ...extraArgs], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || ![0, 1].includes(result.status)) {
    throw new Error(`npm audit could not run: ${result.error?.message ?? result.stderr ?? result.status}`);
  }
  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    throw new Error("npm audit did not return valid JSON; refusing to approve findings.");
  }
  if (report.error) throw new Error(`npm audit returned an error: ${JSON.stringify(report.error)}`);
  return { report, exitCode: result.status };
}

function main() {
  const lock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));

  // A dev-only exception must never permit vulnerabilities in shipped dependencies.
  const production = npmAudit(["--omit=dev"]);
  if (production.exitCode !== 0 ||
      Object.keys(production.report.vulnerabilities ?? {}).length !== 0) {
    throw new Error("Production dependency audit failed. Deployment must remain blocked.");
  }

  const full = npmAudit();
  const assessment = assessAudit(full.report, lock);
  if (!assessment.ok) throw new Error(`Full dependency audit blocked: ${assessment.reason}`);
  if (full.exitCode !== 0 && assessment.exceptionCount === 0) {
    throw new Error("npm audit failed without a recognized finding.");
  }

  if (assessment.exceptionCount) {
    console.warn(
      `SECURITY REVIEW REQUIRED: npm audit still finds ${assessment.exceptionCount} high-severity ` +
      `development-tooling findings from ${ADVISORY_URL}. No upstream fix is published. ` +
      "Only the precise reviewed chain is provisionally allowed; all new findings fail CI."
    );
  } else {
    console.log("Full npm audit passed with no findings.");
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
