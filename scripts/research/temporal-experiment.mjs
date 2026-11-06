// Runs the replacement-recognizer experiment (lib/temporal-experiment.ts):
// the production starter rules and the temporal baseline on the same
// signer-disjoint folds. Prints and writes AGGREGATE counts only: never frames,
// landmarks or clip identifiers.
//
//   node scripts/research/temporal-experiment.mjs synthetic <out.json>
//       synthetic kinematic signers (reproducible anywhere; a mechanics check, not evidence)
//   node scripts/research/temporal-experiment.mjs wlasl <clips.json> <captures-dir> <out.json>
//       licensed WLASL captures on a CI runner (all clips exposed by the PR #55 evaluation)
//   node scripts/research/temporal-experiment.mjs jsonl <examples.jsonl> <out.json>
//       consented landmark examples, one JSON object per line:
//       {"id","gloss"|null,"kind","signer","source","exposure","frames"}; keep under evaluation/raw/
import { build } from "esbuild";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";

const ENTRY = `
  export { runExperiment } from "./lib/temporal-experiment";
  export { starterRulesPredictor, temporalBaselinePredictor } from "./lib/temporal-predictors";
  export { BASELINE_CONFIG } from "./lib/temporal-baseline";
  export { makeSign } from "./tests/fixtures/asl-motion";
  export { NEGATIVE_CONTROLS } from "./tests/fixtures/asl-negative-controls";
`;
const out = await build({ stdin: { contents: ENTRY, resolveDir: process.cwd(), loader: "ts" }, bundle: true, write: false, format: "esm", platform: "node", logLevel: "silent" });
const lib = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString("base64")}`);

const STARTER = new Set(["HELLO", "NO", "YES", "PLEASE", "SORRY", "THANK YOU"]);
const [mode, ...args] = process.argv.slice(2);
let examples, target, note = [];
if (mode === "synthetic") {
  [target] = args;
  const signers = [[1, 0, 900, 0, "Right"], [1.12, 0.03, 1100, 0.002, "Right"], [0.9, -0.02, 750, 0.003, "Left"], [1.05, 0.01, 1300, 0.001, "Right"], [0.95, 0.02, 1000, 0.002, "Left"]];
  examples = signers.flatMap(([scale, shiftY, duration, jitter, side], i) => [
    ...[...STARTER].flatMap(gloss => [0, 1].map(take => ({ id: `s${i}-${gloss}-${take}`, gloss, kind: "target", signer: `s${i}`, source: "synthetic", exposure: "untouched",
      frames: lib.makeSign(gloss, { scale, shiftY, jitter, side, duration: duration + take * 150, count: Math.round((duration + take * 150) / 45) }) }))),
    ...Object.entries(lib.NEGATIVE_CONTROLS).map(([name, make]) => ({ id: `s${i}-${name}`, gloss: null, kind: "everyday", signer: `s${i}`, source: "synthetic", exposure: "untouched", frames: make() })),
  ]);
  note = ["Synthetic kinematic signers: checks the pipeline end to end; says nothing about real signing."];
} else if (mode === "wlasl") {
  const [clipsPath, capturesDir] = args; target = args[2];
  const clips = new Map(JSON.parse(readFileSync(clipsPath, "utf8")).map(c => [c.id, c]));
  examples = readdirSync(capturesDir).filter(n => n.endsWith(".json")).map(n => JSON.parse(readFileSync(join(capturesDir, n), "utf8")))
    .filter(c => clips.has(c.id) && c.frames?.length).map(c => {
      const clip = clips.get(c.id), gloss = String(clip.gloss).toUpperCase();
      const isTarget = clip.set.endsWith("positive") && STARTER.has(gloss);
      return { id: c.id, gloss: isTarget ? gloss : null, kind: isTarget ? "target" : "other-sign", signer: `wlasl-${clip.signer ?? "unknown"}`, source: "WLASL (C-UDA)",
        // Every one of these clips was looked at in the PR #55 starter-reliability evaluation.
        exposure: "exposed", frames: c.frames };
    });
  note = ["WLASL direct clips (C-UDA), captured once on the CI runner with the production VisionEngine.",
    "Baseline configuration fixed before this run (lib/temporal-baseline.ts BASELINE_CONFIG); no tuning on these clips."];
} else if (mode === "jsonl") {
  const [file] = args; target = args[1];
  examples = readFileSync(file, "utf8").split("\n").filter(Boolean).map(line => JSON.parse(line));
} else throw new Error("usage: temporal-experiment.mjs synthetic <out> | wlasl <clips.json> <captures> <out> | jsonl <file> <out>");

const started = Date.now();
const articulated = { ...lib.BASELINE_CONFIG, articulated: true };
const report = lib.runExperiment(examples, [lib.starterRulesPredictor(), lib.temporalBaselinePredictor(),
  lib.temporalBaselinePredictor(articulated, "articulated-timed"),
  lib.temporalBaselinePredictor({ ...articulated, guardedCalibration: true }, "articulated-guarded")], { note });
let commit = null;
try { commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(); } catch { /* not a checkout */ }
const result = { ...report, mode, commit, baseline_config: lib.BASELINE_CONFIG,
  variant_configs: { "articulated-timed": articulated, "articulated-guarded": { ...articulated, guardedCalibration: true } },
  runtime_s: Math.round((Date.now() - started) / 1000) };
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, JSON.stringify(result, null, 1));
const brief = Object.fromEntries(Object.entries(report.predictors).map(([name, r]) => [name, {
  targets: `${r.all.targets.correct}/${r.all.targets.support} correct, ${r.all.targets.wrong} wrong, ${r.all.targets.abstained} abstained`,
  other: `${r.all.other.falseAccept}/${r.all.other.support} accepted as a target sign` }]));
console.log("TEMPORAL-EXPERIMENT", JSON.stringify({ mode, dataset: report.dataset, folds: report.folds.count, predictors: brief, caveats: report.caveats }));
for (const [name, r] of Object.entries(report.predictors)) {
  console.log("TEMPORAL-BY-GLOSS", JSON.stringify({ name, byGloss: r.all.targets.byGloss, falseAcceptAs: r.all.other.falseAcceptAs }));
}
