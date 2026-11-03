// Builds every release-relevant configuration and inspects the ARTIFACT each
// one produces: the inlined flag (compiled UI markers), the research models
// and workers, and the runtime manifest. Expected outcomes are fixed below; a
// mismatch fails the run.
//
//   node scripts/release-artifact-matrix.mjs [--only name,name] [--skip-rsl] [--keep dir]
//
// --skip-rsl runs the production ("full") steps without the external RSL
// download (its host is unreachable from some sandboxes); every other full
// step, including prepare-export, pruning and secure-export, runs unchanged,
// and verify-runtime's RSL weight check is reported separately. CI's
// firebase-build-check runs the true full build with the RSL model.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { runCommandSync } from "./run-command.mjs";
import { FINGERSPELLING_ASSETS, FINGERSPELLING_UI_MARKERS } from "../lib/release-flags.mjs";

const { values } = parseArgs({ options: { only: { type: "string" }, "skip-rsl": { type: "boolean", default: false }, keep: { type: "string" }, out: { type: "string", default: "work/release-artifact-matrix.json" } } });
const FLAG = "NEXT_PUBLIC_SIGNRELAY_FINGERSPELLING";
const fullSteps = (skipRsl) => [
  ["node", "scripts/verify-vision-runtime.mjs"],
  ...(skipRsl ? [] : [["npm", "run", "install:rsl-model"]]),
  ["node", "scripts/verify-bdsl-assets.mjs"], ["node", "scripts/verify-lse-assets.mjs"], ["node", "scripts/verify-psl-assets.mjs"],
  ["node", "scripts/prepare-export.mjs"], ["node", "scripts/install-vision-assets.mjs"], ["npm", "run", "build:worker"],
  ["npx", "next", "build"], ["node", "scripts/exclude-private-routes.mjs"], ["node", "scripts/prune-research.mjs", "out"],
  ["node", "scripts/secure-export.mjs"], ["node", "scripts/verify-runtime.mjs", "--out", "out", "--profile", "full"],
];
// Exactly vercel.json's buildCommand.
const vercelSteps = () => JSON.parse(readFileSync("vercel.json", "utf8")).buildCommand.split(" && ").map(c => c.trim().split(/\s+/));
const profileSteps = (profile) => [["node", "scripts/build-profile.mjs", profile]];

/** expect: "on" | "off" | "refused" (the build must stop before producing an export). */
const CONFIGS = [
  { name: "full-default", steps: fullSteps, env: {}, expect: "off", production: true },
  // Next itself refuses to export a non-standard NODE_ENV=development build, so nothing can ship.
  { name: "full-node-env-development", steps: fullSteps, env: { NODE_ENV: "development" }, expect: "refused", production: true },
  { name: "full-explicit-off", steps: fullSteps, env: { [FLAG]: "off" }, expect: "off", production: true },
  { name: "full-explicit-on-unacknowledged", steps: fullSteps, env: { [FLAG]: "on" }, expect: "refused", production: true },
  { name: "full-explicit-on-research-export", steps: fullSteps, env: { [FLAG]: "on", SIGNRELAY_RESEARCH_EXPORT: "1" }, expect: "on" },
  { name: "full-dotenv-on", steps: fullSteps, env: {}, dotenv: `${FLAG}=on\n`, expect: "refused", production: true },
  { name: "vercel-production", steps: vercelSteps, env: { VERCEL_ENV: "production" }, expect: "off", production: true },
  { name: "vercel-production-explicit-on", steps: vercelSteps, env: { VERCEL_ENV: "production", [FLAG]: "on" }, expect: "refused", production: true },
  { name: "vercel-preview", steps: vercelSteps, env: { VERCEL_ENV: "preview" }, expect: "on" },
  { name: "asl-demo-default", steps: () => profileSteps("asl-demo"), env: {}, expect: "off" },
  { name: "rehearsal-default", steps: () => profileSteps("rehearsal"), env: {}, expect: "on" },
  { name: "rehearsal-explicit-off", steps: () => profileSteps("rehearsal"), env: { [FLAG]: "off" }, expect: "off" },
];

function inspect() {
  const { modelDir, workers, keptNotices } = FINGERSPELLING_ASSETS;
  const models = existsSync(join("out", modelDir)) ? readdirSync(join("out", modelDir)).filter(n => !keptNotices.has(n)) : [];
  const shippedWorkers = workers.filter(w => existsSync(join("out", "workers", w)));
  const js = [];
  const walk = (dir) => { for (const e of readdirSync(dir, { withFileTypes: true })) { const p = join(dir, e.name); if (e.isDirectory()) walk(p); else if (p.endsWith(".js")) js.push(p); } };
  if (existsSync("out/_next")) walk("out/_next");
  const text = js.map(f => readFileSync(f, "utf8"));
  const markers = Object.fromEntries(FINGERSPELLING_UI_MARKERS.map(m => [m, text.some(t => t.includes(m))]));
  const manifest = existsSync("out/runtime-manifest.json") ? JSON.parse(readFileSync("out/runtime-manifest.json", "utf8")) : null;
  const compiled = Object.values(markers).every(Boolean);
  return { researchModels: models, researchWorkers: shippedWorkers, uiMarkers: markers, compiledUi: compiled,
    manifestFingerspelling: manifest?.fingerspelling ?? null, manifestProfile: manifest?.profile ?? null };
}

const selected = values.only ? CONFIGS.filter(c => values.only.split(",").includes(c.name)) : CONFIGS;
const results = [];
for (const config of selected) {
  rmSync("out", { recursive: true, force: true });
  if (config.dotenv) writeFileSync(".env.local", config.dotenv);
  const env = { ...process.env, ...config.env };
  delete env[FLAG]; delete env.SIGNRELAY_RESEARCH_EXPORT; delete env.VERCEL_ENV; delete env.NEXT_PUBLIC_SIGNRELAY_PROFILE;
  Object.assign(env, config.env);
  let failedStep = null, failure = "";
  try {
    for (const [command, ...args] of config.steps(values["skip-rsl"])) {
      const run = runCommandSync(command, args, { env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
      if (run.status !== 0) { failedStep = [command, ...args].join(" "); failure = `${run.stdout ?? ""}${run.stderr ?? ""}`.trim().split("\n").slice(-4).join(" | "); break; }
    }
  } finally { if (config.dotenv) rmSync(".env.local", { force: true }); }
  const artifact = failedStep && !existsSync("out/_next") ? null : inspect();
  // With --skip-rsl the only acceptable full-profile verify failure is the missing RSL weights.
  const rslOnly = failedStep?.includes("verify-runtime") && values["skip-rsl"] && /rsl1000-slovo|Slovo|RSL/i.test(failure) && !/fingerspelling/i.test(failure);
  let outcome;
  if (failedStep && !rslOnly) outcome = "refused";
  else outcome = artifact?.compiledUi ? "on" : "off";
  const assetsMatch = outcome === "refused" || (outcome === "on" ? artifact.researchModels.length >= 3 && artifact.researchWorkers.length === 2 : artifact.researchModels.length === 0 && artifact.researchWorkers.length === 0);
  const pass = outcome === config.expect && assetsMatch && (outcome === "refused" || !artifact.manifestFingerspelling || artifact.manifestFingerspelling === outcome || rslOnly);
  const row = { name: config.name, expect: config.expect, outcome, pass, failedStep: rslOnly ? null : failedStep, failure: rslOnly ? undefined : failure || undefined,
    rslWeightsMissingOnly: rslOnly || undefined, ...artifact };
  results.push(row);
  console.log("MATRIX", JSON.stringify(row));
  if (values.keep && existsSync("out")) { mkdirSync(values.keep, { recursive: true }); cpSync("out", join(values.keep, config.name), { recursive: true }); }
}
mkdirSync("work", { recursive: true });
writeFileSync(values.out, JSON.stringify({ skipRsl: values["skip-rsl"], results }, null, 1));
const failed = results.filter(r => !r.pass);
console.log(`RELEASE-ARTIFACT-MATRIX ${results.length - failed.length}/${results.length} as expected${failed.length ? `; unexpected: ${failed.map(r => r.name).join(", ")}` : ""}`);
process.exit(failed.length ? 1 : 0);
