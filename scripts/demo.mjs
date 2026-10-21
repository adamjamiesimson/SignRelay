// One-command offline GITEX demo.
//
//   npm run demo:prepare   build the ASL demo export and verify its exact runtime
//   npm run demo:serve     refuse anything but a verified ASL demo export, then serve it on loopback
//   npm run demo:check -- <chrome>   strict browser check: no request may leave the machine
//
// The demo build needs network access once (npm ci and the pinned vision
// models). After demo:prepare, serving and running it needs none.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** Reasons the export in `root` is not a verified ASL demo build (empty when it is).
 * @param {string} [root]
 * @param {() => { status: number | null, stdout: string, stderr: string }} [verify] */
export function demoExportProblems(root = "out", verify = () => spawnSync("node", ["scripts/verify-runtime.mjs", "--out", root, "--profile", "asl-demo"], { encoding: "utf8" })) {
  if (!existsSync(join(root, "index.html"))) return [`no export in ${root}/ — run npm run demo:prepare`];
  const path = join(root, "runtime-manifest.json");
  if (!existsSync(path)) return [`${path} is missing — run npm run demo:prepare`];
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  if (manifest.profile !== "asl-demo") return [`${root}/ is the ${manifest.profile} build, not the ASL demo — run npm run demo:prepare`];
  const result = verify();
  if (result.status !== 0) return [`runtime verification failed:\n${result.stdout}${result.stderr}`];
  return [];
}

/** What demo:serve prints. `real_video_evidence` is `{ outcome, evidence }` as
 * written by scripts/verify-runtime.mjs.
 * @param {{ recognition_worker_sha256: string, matches_committed_worker: boolean,
 *   real_video_evidence?: { outcome: { signed_trials: number, correct: number, wrong_accepted: number, abstained: number } } | null }} manifest
 * @param {string} port */
export function serveBanner(manifest, port) {
  const outcome = manifest.real_video_evidence?.outcome;
  return [
    `SignRelay ASL demo build — http://127.0.0.1:${port}/`,
    `Recognition worker ${manifest.recognition_worker_sha256.slice(0, 12)} (matches committed bundle: ${manifest.matches_committed_worker}).`,
    outcome ? `Recorded development evidence: ${outcome.correct} of ${outcome.signed_trials} previously inspected publisher clips correct, ${outcome.wrong_accepted} wrong, ${outcome.abstained} no match. Not live-camera or signer accuracy.`
      : "No real-video development evidence is recorded for this worker.",
    "Serving on loopback only. Release status: NO-GO; physical-camera checks remain manual.",
  ].join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, ...rest] = process.argv.slice(2);
  const run = (cmd, args) => { const result = spawnSync(cmd, args, { stdio: "inherit" }); if (result.status !== 0) process.exit(result.status ?? 1); };
  if (command === "prepare") {
    run("npm", ["run", "build:asl-demo"]);
    console.log("\nDemo export prepared. Next: npm run demo:serve (works with networking turned off).");
  } else if (command === "serve") {
    const problems = demoExportProblems();
    if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
    const manifest = JSON.parse(readFileSync("out/runtime-manifest.json", "utf8"));
    const port = rest.includes("--port") ? rest[rest.indexOf("--port") + 1] : "3000";
    console.log(serveBanner(manifest, port));
    run("node", ["scripts/serve-export.mjs", "--host", "127.0.0.1", "--port", port]);
  } else if (command === "check") {
    const problems = demoExportProblems();
    if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
    run("node", ["tests/offline-demo-strict-smoke.mjs", ...rest]);
  } else {
    console.error("Usage: node scripts/demo.mjs prepare | serve [--port 3000] | check <chrome executable>");
    process.exit(1);
  }
}
