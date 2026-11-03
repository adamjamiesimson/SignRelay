// Rollback compatibility of saved personal signs across the PR #43
// trajectory-v3 boundary. Templates are created exactly as the current
// workspace saves them; main's real matcher (from git) then matches live
// synthetic signs against them. Synthetic kinematics; no recording.
// usage: node scripts/diagnostics/rollback-template-compat.mjs [mainRef] [out.json]
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const [ref = "origin/main", out = "work/rollback-template-compat.json"] = process.argv.slice(2);
const dir = mkdtempSync(join(tmpdir(), "signrelay-rollback-"));
try {
  // Main's lib tree, extracted read-only from git.
  execFileSync("sh", ["-c", `git archive ${ref} lib | tar -x -C ${dir}`]);
  const bundle = async (entry, file, resolveDir) => {
    await build({ stdin: { contents: entry, resolveDir, loader: "ts" }, bundle: true, platform: "node", format: "esm", outfile: join(dir, file), logLevel: "error",
      external: ["onnxruntime-web"], alias: { "@": resolveDir } });
    return import(pathToFileURL(join(dir, file)).href);
  };
  const main = await bundle(`export { recognizePersonalTemplate } from "./lib/personalized-recognition.ts";`, "main.mjs", dir);
  const current = await bundle(`export { recognizePersonalTemplate, prepareCalibrationSequence } from "./lib/personalized-recognition.ts"; export { makeSign } from "./tests/fixtures/asl-motion.ts";`, "current.mjs", process.cwd());
  const signs = ["HELLO", "THANK YOU", "PLEASE", "SORRY", "YES", "NO"];
  const save = (sign, normalization, n) => ({ id: `${sign}-${n}`, language: "asl", gloss: sign, text: sign, createdAt: n, ...(normalization ? { normalization } : {}),
    frames: current.prepareCalibrationSequence(current.makeSign(sign, { jitter: 0.004 * (n + 1) }), normalization) });
  const rows = [];
  for (const [label, normalization] of [["saved by current build (trajectory-v3)", "trajectory-v3"], ["saved by main (legacy)", undefined]]) {
    const templates = signs.flatMap(sign => [0, 1, 2].map(n => save(sign, normalization, n)));
    for (const [reader, matcher] of [["main matcher", main], ["current matcher", current]]) {
      let correct = 0, wrong = 0, none = 0;
      for (const sign of signs) for (const seed of [3, 4]) {
        const result = matcher.recognizePersonalTemplate(current.makeSign(sign, { jitter: 0.004 * (seed + 1), shiftY: 0.01 * seed }), templates);
        const gloss = result?.label ?? result?.gloss ?? null;
        if (!gloss) none++; else if (gloss === sign) correct++; else wrong++;
      }
      rows.push({ templates: label, reader, trials: signs.length * 2, correct, wrong, none });
    }
  }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ kind: "synthetic kinematics; current save path vs main and current matchers", mainRef: execFileSync("git", ["rev-parse", ref], { encoding: "utf8" }).trim(), rows }, null, 1));
  console.log("ROLLBACK-TEMPLATE-COMPAT", JSON.stringify(rows));
} finally { rmSync(dir, { recursive: true, force: true }); }
