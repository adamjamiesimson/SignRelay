// Reproducible readiness report: runs the repository's own checks, records
// exact commands, exit codes and parsed results, and fingerprints the runtime.
// A failing check is recorded, never hidden; the strict dependency audit is a
// separate release gate and is reported apart from build/test results.
//
//   node scripts/readiness.mjs --label baseline [--browser /path/to/chrome] [--build asl-demo[,rehearsal]]
//   node scripts/readiness.mjs --label final --compare docs/gitex/sprint-2/baseline-<sha>.json
// Each listed profile is built, then its browser smokes, rendered-export and
// runtime checks run against that export. List asl-demo last to leave the
// demo build in out/.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const sha256 = path => existsSync(path) ? createHash("sha256").update(readFileSync(path)).digest("hex") : null;
const git = args => spawnSync("git", args, { encoding: "utf8" }).stdout.trim();

export const BROWSER_SMOKES = {
  full: ["workspace-browser-smoke", "offline-vision-smoke", "lifecycle-stress-smoke", "fault-injection-smoke"],
  "asl-demo": ["offline-vision-smoke", "offline-demo-strict-smoke", "lifecycle-stress-smoke", "fault-injection-smoke"],
  rehearsal: ["gitex-rehearsal-smoke", "transcript-a11y-smoke"],
};

/** Release is decided by people and evidence, never by green software checks alone. */
export function releaseDecision({ strictPassed, manualGates }) {
  const reasons = [];
  if (!strictPassed) reasons.push("Strict dependency release gate fails (dev-only braces advisories; owner decision pending).");
  for (const gate of manualGates) reasons.push(`Manual gate ${gate.id} pending: ${gate.requirement}`);
  reasons.push("No unseen, live-camera or new-signer evaluation exists; real no-sign false acceptance is not measured.");
  return { status: "NO-GO", reasons };
}

/** Release-gate categories are reported separately; they are never folded into "build". */
export const CHECKS = [
  { id: "typecheck", category: "code", command: ["npm", "run", "typecheck"] },
  { id: "lint", category: "code", command: ["npm", "run", "lint"] },
  { id: "unit-tests", category: "code", command: ["npm", "test"], parse: "vitest" },
  { id: "worker-build", category: "build", command: ["npm", "run", "build:worker"] },
  { id: "repo-guard", category: "privacy-integrity", command: ["npm", "run", "repo:guard"] },
  { id: "secret-scan", category: "privacy-integrity", command: ["npm", "run", "audit:secrets"] },
  { id: "dependency-gate", category: "security", command: ["npm", "run", "audit:deps"] },
  { id: "production-audit", category: "security", command: ["npm", "audit", "--omit=dev"] },
  { id: "strict-audit", category: "security-release-gate", command: ["npm", "run", "audit:security"],
    note: "Strict zero-advisory release gate. Expected to fail while the reviewed dev-only braces chain exists; owner decision." },
];

export function parseVitest(output) {
  const strip = output.replace(/\u001b\[[0-9;]*m/g, "");
  const files = strip.match(/Test Files\s+(?:(\d+) failed \| )?(\d+) passed \((\d+)\)/);
  const tests = strip.match(/Tests\s+(?:(\d+) failed \| )?(\d+) passed \((\d+)\)/);
  if (!files || !tests) return null;
  return { test_files: Number(files[3]), test_files_failed: Number(files[1] ?? 0),
    tests: Number(tests[3]), tests_failed: Number(tests[1] ?? 0), tests_passed: Number(tests[2]) };
}

export function runCheck(check, run = spawnSync) {
  const started = Date.now();
  const result = run(check.command[0], check.command.slice(1), { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, env: process.env });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  return { id: check.id, category: check.category, command: check.command.join(" "), exit_code: result.status,
    passed: result.status === 0, duration_ms: Date.now() - started,
    ...(check.parse === "vitest" ? { summary: parseVitest(output) } : {}),
    ...(check.note ? { note: check.note } : {}),
    tail: output.split("\n").filter(Boolean).slice(-6).map(line => line.replace(/\u001b\[[0-9;]*m/g, "").slice(0, 240)) };
}

export function runtimeFingerprint() {
  const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
  const version = name => lock.packages?.[`node_modules/${name}`]?.version ?? null;
  return {
    commit: git(["rev-parse", "HEAD"]), branch: git(["rev-parse", "--abbrev-ref", "HEAD"]),
    worktree_dirty: git(["status", "--porcelain"]).length > 0,
    node: process.version, npm: spawnSync("npm", ["--version"], { encoding: "utf8" }).stdout.trim(),
    dependencies: Object.fromEntries(["next", "react", "@mediapipe/tasks-vision", "onnxruntime-web", "vitest", "vite", "eslint-config-next", "braces"]
      .map(name => [name, version(name)])),
    committed_recognition_worker_sha256: (() => {
      const bytes = spawnSync("git", ["show", "HEAD:public/workers/recognition.worker.js"], { encoding: "buffer", maxBuffer: 64 * 1024 * 1024 }).stdout;
      return bytes?.length ? createHash("sha256").update(bytes).digest("hex") : null;
    })(),
    built_recognition_worker_sha256: sha256("public/workers/recognition.worker.js"),
    asl_model_sha256: sha256("public/models/asl2000-tgcn/model.json"),
    asl_labels_sha256: sha256("public/models/asl2000-tgcn/labels.json"),
  };
}

export function compareReports(base, current) {
  const byId = new Map(base.checks.map(check => [check.id, check]));
  return current.checks.flatMap(check => {
    const before = byId.get(check.id);
    if (!before) return [{ id: check.id, change: "new-check", passed: check.passed }];
    if (before.passed && !check.passed) return [{ id: check.id, change: "regression" }];
    if (!before.passed && check.passed) return [{ id: check.id, change: "fixed" }];
    const a = before.summary, b = check.summary;
    if (a && b && b.tests < a.tests) return [{ id: check.id, change: "fewer-tests", before: a.tests, after: b.tests }];
    return [];
  });
}

export function markdown(report) {
  const lines = [`# SignRelay ${report.label} readiness report`, "",
    `Commit \`${report.runtime.commit}\` on \`${report.runtime.branch}\`${report.runtime.worktree_dirty ? " (**uncommitted changes present**)" : ""}, generated ${report.generated_at}. Node ${report.runtime.node}, npm ${report.runtime.npm}.`, "",
    "| Check | Category | Command | Exit | Result |", "| --- | --- | --- | ---: | --- |"];
  for (const check of report.checks) {
    const detail = check.summary ? ` (${check.summary.tests - check.summary.tests_failed}/${check.summary.tests} tests, ${check.summary.test_files} files)` : "";
    lines.push(`| ${check.id} | ${check.category} | \`${check.command}\` | ${check.exit_code} | ${check.passed ? "pass" : "**fail**"}${detail} |`);
  }
  lines.push("", `Build/test/privacy checks: **${report.verdicts.build_and_tests}**. Strict dependency release gate: **${report.verdicts.strict_release_gate}**.`);
  if (report.release) lines.push("", `## Release: ${report.release.status}`, "", ...report.release.reasons.map(reason => `- ${reason}`));
  if (report.comparison) {
    lines.push("", "## Compared with " + report.comparison.base, "");
    lines.push(report.comparison.changes.length ? report.comparison.changes.map(change => `- ${change.id}: ${change.change}${change.before !== undefined ? ` (${change.before} → ${change.after})` : ""}`).join("\n") : "- No check changed outcome.");
  }
  lines.push("", "## Runtime fingerprint", "", "```json", JSON.stringify(report.runtime, null, 2), "```",
    "", "Software checks only. Nothing here measures real-signer, live-camera or device accuracy.");
  return lines.join("\n") + "\n";
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
  const label = option("--label") ?? "report";
  const checks = [...CHECKS];
  const browser = option("--browser");
  const builds = option("--build")?.split(",").filter(Boolean) ?? [];
  const current = existsSync("out/runtime-manifest.json") ? JSON.parse(readFileSync("out/runtime-manifest.json", "utf8")).profile : "full";
  const exportChecks = (profile, suffix) => {
    // Browser smokes depend on which export is in out/: the multilingual workspace
    // smoke needs the full build; the strict offline check needs the ASL demo build.
    if (browser) for (const smoke of BROWSER_SMOKES[profile] ?? BROWSER_SMOKES.full)
      if (existsSync(`tests/${smoke}.mjs`)) checks.push({ id: `${smoke}${suffix}`, category: "browser", command: ["node", `tests/${smoke}.mjs`, browser] });
    checks.push({ id: `rendered-export${suffix}`, category: "privacy-integrity", command: ["npm", "run", "test:rendered"] });
    checks.push({ id: `runtime-verifier${suffix}`, category: "build", command: ["node", "scripts/verify-runtime.mjs", "--out", "out", "--profile", profile] });
  };
  for (const profile of builds) {
    checks.push({ id: `build-${profile}`, category: "build", command: ["npm", "run", profile === "full" ? "build:firebase" : `build:${profile}`] });
    exportChecks(profile, builds.length > 1 ? `:${profile}` : "");
  }
  if (!builds.length && existsSync("out/index.html")) exportChecks(current, "");
  const results = [];
  for (const check of checks) { process.stderr.write(`running ${check.id}…\n`); results.push(runCheck(check)); }
  const nonGate = results.filter(check => check.category !== "security-release-gate");
  const strict = results.find(check => check.category === "security-release-gate");
  const contract = JSON.parse(readFileSync("docs/gitex/demo-contract.json", "utf8"));
  const report = { schema: 1, label, generated_at: new Date().toISOString(), runtime: runtimeFingerprint(), checks: results,
    verdicts: { build_and_tests: nonGate.every(check => check.passed) ? "PASS" : "FAIL",
      strict_release_gate: strict ? (strict.passed ? "PASS" : "FAIL (owner decision pending)") : "NOT RUN" },
    release: releaseDecision({ strictPassed: strict?.passed === true, manualGates: contract.manual_before_demo }),
    evidence: { evaluated_runtimes: JSON.parse(readFileSync("docs/evaluation/evaluated-runtimes.json", "utf8")).runtimes
      .map(entry => ({ worker_sha256: entry.worker_sha256, outcome: entry.outcome, evidence: entry.evidence })),
      note: "Real-video evidence is 11 previously inspected publisher clips; synthetic suites are regression records, not accuracy." } };
  const compare = option("--compare");
  if (compare) report.comparison = { base: compare, changes: compareReports(JSON.parse(readFileSync(compare, "utf8")), report) };
  mkdirSync("docs/gitex/sprint-2", { recursive: true });
  const stem = `docs/gitex/sprint-2/${label}-${report.runtime.commit.slice(0, 7)}`;
  writeFileSync(`${stem}.json`, JSON.stringify(report, null, 2) + "\n");
  writeFileSync(`${stem}.md`, markdown(report));
  console.log(JSON.stringify({ written: [`${stem}.json`, `${stem}.md`], verdicts: report.verdicts }));
}
