// One command for the BSL A/B on licensed recordings (see docs/bsl-sprint-2026-11-24/PROVIDING_RECORDINGS.md).
//
// npm run eval:bsl -- <manifest.json> [--chrome=/path/to/chrome] [--out=evaluation/raw/bsl-runs/<name>] [--skip-baseline]
//
// 1. Builds the main-branch worker as the baseline (git worktree of origin/main, bundled into out/).
// 2. Browser pass (real tracker + candidate worker, v2) that also captures tracker traces (git-ignored).
// 3. Browser pass with the baseline worker.
// 4. Legacy and v2 inputs replayed on the *identical* captured observations (Node + real ONNX).
// 5. Prints one comparison table and writes summary.json next to the raw results.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

const [manifest, ...flags] = process.argv.slice(2);
if (!manifest) throw new Error("Usage: npm run eval:bsl -- <manifest.json> [--chrome=...] [--out=...] [--skip-baseline]");
const option = name => flags.find(flag => flag.startsWith(`--${name}=`))?.slice(name.length + 3);
const chrome = option("chrome") ?? findChrome();
const name = path.basename(manifest, ".json");
const out = option("out") ?? path.join("evaluation/raw/bsl-runs", `${name}-${new Date().toISOString().replace(/[:.]/g, "-")}`);
const traces = path.join("evaluation/raw/bsl-traces");
execFileSync("git", ["check-ignore", "--quiet", path.join(out, "probe.json")]);
mkdirSync(out, { recursive: true });
const run = (args, label) => { console.log(`\n▶ ${label}`); execFileSync(process.execPath, args, { stdio: "inherit" }); };

if (!existsSync("out/__qa/recognition-lab.html")) throw new Error("Run `npm run build:firebase && node scripts/prepare-recognition-lab.mjs` first");
execFileSync("npx", ["esbuild", "workers/recognition.worker.ts", "--bundle", "--format=esm", "--platform=browser", "--target=es2020",
  "--outfile=out/workers/recognition.worker.js", "--log-level=warning"], { stdio: "inherit" });
const skipBaseline = flags.includes("--skip-baseline");
if (!skipBaseline) buildBaseline();

run(["scripts/diagnostics/run-bsl-video-evaluation.mjs", chrome, manifest, path.join(out, "browser-candidate-v2.json"),
  "--bsl-engine=v2", `--traces=${traces}`, "--fetch-assets-via-node"], "Browser: candidate worker, v2 input (captures traces)");
if (!skipBaseline) run(["scripts/diagnostics/run-bsl-video-evaluation.mjs", chrome, manifest, path.join(out, "browser-baseline.json"),
  "--worker=baseline", "--fetch-assets-via-node"], "Browser: main-branch baseline worker");
for (const engine of ["legacy", "v2"]) run(["scripts/diagnostics/bsl-offline-replay.mjs", manifest, traces,
  path.join(out, `replay-${engine}.json`), `--bsl-engine=${engine}`], `Identical observations: ${engine} input`);

const read = file => existsSync(path.join(out, file)) ? JSON.parse(readFileSync(path.join(out, file), "utf8")).summary.all : null;
const rows = [["browser baseline (main)", read("browser-baseline.json")], ["browser candidate v2", read("browser-candidate-v2.json")],
  ["replay legacy input", read("replay-legacy.json")], ["replay v2 input", read("replay-v2.json")]].filter(([, summary]) => summary);
const percent = value => value === null || value === undefined ? "—" : `${(value * 100).toFixed(1)}%`;
console.log("\n| variant | supported | correct | wrong | abstained | top-1 | top-5 | precision | negatives | false accepts |");
console.log("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
for (const [label, s] of rows) console.log(`| ${label} | ${s.supported_trials} | ${s.correct} | ${s.wrong} | ${s.abstained} | ${percent(s.top1_threshold_free)} | ${percent(s.top5_threshold_free)} | ${percent(s.precision_when_accepted)} | ${s.negative_trials} | ${s.false_accepts} |`);
writeFileSync(path.join(out, "summary.json"), JSON.stringify(Object.fromEntries(rows.map(([label, s]) => [label, { ...s, per_trial: undefined }])), null, 2) + "\n");
console.log(`\nRaw results: ${out}`);

function buildBaseline() {
  const tree = path.resolve("out/.bsl-baseline-tree");
  rmSync(tree, { recursive: true, force: true });
  execFileSync("git", ["fetch", "--quiet", "origin", "main"], { stdio: "inherit" });
  execFileSync("git", ["worktree", "add", "--force", "--detach", tree, "FETCH_HEAD"], { stdio: "inherit" });
  try {
    symlinkSync(path.resolve("node_modules"), path.join(tree, "node_modules"));
    execFileSync("npx", ["esbuild", "workers/recognition.worker.ts", "--bundle", "--format=esm", "--platform=browser", "--target=es2020",
      `--outfile=${path.resolve("out/workers/baseline-recognition.worker.js")}`, "--log-level=warning"], { cwd: tree, stdio: "inherit" });
  } finally {
    execFileSync("git", ["worktree", "remove", "--force", tree]);
  }
}

function findChrome() {
  for (const candidate of [process.env.CHROME_PATH, "/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell",
    "/usr/bin/google-chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]) if (candidate && existsSync(candidate)) return candidate;
  throw new Error("Pass --chrome=/path/to/chrome (Chrome, Chromium or chrome-headless-shell)");
}
