// Fail-closed dependency gate. Production advisories always fail. A
// development-only advisory passes only with an exact, unexpired human review
// in docs/security/dependency-exceptions.json; anything new or expired fails.
// `npm run audit:security` remains the strict zero-advisory release check.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const advisoryId = url => typeof url === "string" ? url.match(/GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}/)?.[0] ?? null : null;

/** Root advisories (objects in `via`) keyed by advisory id + package. */
export function rootAdvisories(report) {
  const roots = [];
  for (const [name, entry] of Object.entries(report?.vulnerabilities ?? {})) {
    for (const via of entry.via ?? []) {
      if (typeof via !== "object" || !via) continue;
      roots.push({ id: advisoryId(via.url), package: via.name ?? name, severity: via.severity, title: via.title, range: via.range, url: via.url });
    }
  }
  return roots;
}

/** @param {{full: object, production: object, exceptions: object, today: string}} input */
export function evaluateAudit({ full, production, exceptions, today }) {
  const failures = [];
  const accepted = [];
  for (const root of rootAdvisories(production)) {
    failures.push(`Production dependency advisory ${root.id ?? root.url} in ${root.package} (${root.severity}) — no exception mechanism applies.`);
  }
  if (Object.keys(production?.vulnerabilities ?? {}).length && !rootAdvisories(production).length) {
    failures.push("Production audit reported vulnerable packages without a parseable advisory.");
  }
  const reviewed = Array.isArray(exceptions?.exceptions) ? exceptions.exceptions : [];
  const covered = new Set();
  for (const root of rootAdvisories(full)) {
    const exception = reviewed.find(item => item.advisory === root.id && item.package === root.package);
    if (!exception) { failures.push(`Unreviewed development advisory ${root.id ?? root.url} in ${root.package} (${root.severity}).`); continue; }
    if (exception.scope !== "development") { failures.push(`${root.id}: exception must be scoped to development dependencies.`); continue; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(exception.expires ?? "") || exception.expires < today) {
      failures.push(`${root.id}: exception expired on ${exception.expires ?? "an unknown date"}; review again.`);
      continue;
    }
    if (!exception.reason || !exception.reviewed_on || !Array.isArray(exception.chain)) {
      failures.push(`${root.id}: exception lacks reason, review date or affected chain.`);
      continue;
    }
    covered.add(root.package);
    for (const name of exception.chain) covered.add(name);
    accepted.push({ advisory: root.id, package: root.package, severity: root.severity, expires: exception.expires });
  }
  // Every vulnerable package must be the root of, or on the chain of, a reviewed advisory.
  for (const name of Object.keys(full?.vulnerabilities ?? {})) {
    if (!covered.has(name) && !failures.some(failure => failure.includes(` in ${name} `))) {
      failures.push(`Vulnerable package ${name} is not explained by a reviewed advisory chain.`);
    }
  }
  const stale = reviewed.filter(item => !accepted.some(found => found.advisory === item.advisory && found.package === item.package))
    .map(item => `${item.advisory} (${item.package}) is no longer reported; remove the exception.`);
  return { ok: failures.length === 0, failures, accepted, stale,
    totals: { full: full?.metadata?.vulnerabilities ?? null, production: production?.metadata?.vulnerabilities ?? null } };
}

export function parseNpmAudit(stdout, exitCode = 0) {
  if (typeof stdout !== "string" || ![0, 1].includes(exitCode)) throw new Error("npm audit did not complete");
  let report;
  try { report = JSON.parse(stdout); }
  catch { throw new Error("npm audit returned invalid JSON"); }
  const entries = report?.vulnerabilities;
  const counts = report?.metadata?.vulnerabilities;
  if (report?.error || report?.auditReportVersion !== 2 || !entries || typeof entries !== "object" || Array.isArray(entries)
    || !Number.isInteger(counts?.total) || counts.total !== Object.keys(entries).length
    || (exitCode === 1 && !counts.total)
    || Object.values(entries).some(entry => !Array.isArray(entry?.via) || !entry.via.length)) {
    throw new Error("npm audit returned an incomplete or failed advisory report");
  }
  return report;
}

function npmAudit(args) {
  const npmEntry = process.env.npm_execpath;
  const command = npmEntry ? process.execPath : "npm";
  const auditArgs = ["audit", "--json", ...args];
  let stdout;
  let exitCode = 0;
  try {
    stdout = execFileSync(command, npmEntry ? [npmEntry, ...auditArgs] : auditArgs,
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  } catch (error) {
    // npm also exits 1 for some registry errors. Require a complete report.
    stdout = error.stdout;
    exitCode = error.status ?? -1;
  }
  return parseNpmAudit(stdout, exitCode);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const exceptions = JSON.parse(readFileSync("docs/security/dependency-exceptions.json", "utf8"));
  const result = evaluateAudit({ full: npmAudit([]), production: npmAudit(["--omit=dev"]), exceptions,
    today: new Date().toISOString().slice(0, 10) });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
}
