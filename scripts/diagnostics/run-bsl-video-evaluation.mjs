// BSL recognition through SignRelay's actual browser pipeline: pinned MediaPipe
// Tasks (VisionEngine) -> production recognition worker -> BSL-1K Pose2Sign.
//
// node scripts/diagnostics/run-bsl-video-evaluation.mjs <chrome> <manifest.json> <output.json>
//   [--worker=candidate|baseline] [--bsl-engine=legacy|v2] [--traces=evaluation/raw/bsl-traces]
//
// The manifest lists local, licence-checked recordings (see docs/bsl-sprint-2026-11-24/PROTOCOL.md).
// Output contains derived results only. With --traces, per-frame landmarks are written to a
// git-ignored directory for offline replay on identical observations; they are never committed.
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { startChrome } from "./chrome-session.mjs";
import { scoreBslTrials } from "./bsl-scoring.mjs";

const [executable, manifestFile, output, ...flags] = process.argv.slice(2);
if (!executable || !manifestFile || !output) throw new Error("Supply Chrome executable, manifest JSON and output JSON");
const option = name => flags.find(flag => flag.startsWith(`--${name}=`))?.slice(name.length + 3);
const workerVariant = option("worker") ?? "candidate";
const bslEngine = option("bsl-engine");
const traceDir = option("traces");
if (!["candidate", "baseline"].includes(workerVariant)) throw new Error("--worker must be candidate or baseline");
if (bslEngine && !["legacy", "v2"].includes(bslEngine)) throw new Error("--bsl-engine must be legacy or v2");
if (traceDir) execFileSync("git", ["check-ignore", "--quiet", path.join(traceDir, "probe.json")]);

const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
const rows = Array.isArray(manifest) ? manifest : manifest.trials;
const sha = async file => createHash("sha256").update(await readFile(file)).digest("hex");
for (const row of rows) {
  if (!["supported", "unsupported", "non_sign", "foreign_sign"].includes(row.category)) throw new Error(`Unknown category for ${row.trial_id}`);
  if (row.category === "supported" && !row.expected_gloss) throw new Error(`${row.trial_id} needs an expected BSL-1K label`);
  if (await sha(row.file) !== row.recording_sha256) throw new Error(`Fingerprint differs: ${row.trial_id}`);
}
const labels = JSON.parse(await readFile("public/models/bsl1064-pose2sign/labels.json", "utf8"));
for (const row of rows) if (row.category === "supported" && !labels.includes(row.expected_gloss)) throw new Error(`${row.expected_gloss} is not a BSL-1K label`);
if (traceDir) await mkdir(traceDir, { recursive: true });

const workerFile = workerVariant === "baseline" ? "out/workers/baseline-recognition.worker.js" : "out/workers/recognition.worker.js";
const workerSha = createHash("sha256").update(await readFile(workerFile)).digest("hex");
const port = 17000 + Math.floor(Math.random() * 1000), origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["scripts/serve-export.mjs", "--port", String(port)], { stdio: "ignore" });
const query = new URLSearchParams({ diagnostics: "1", ...(workerVariant === "baseline" ? { baseline: "1" } : {}), ...(bslEngine ? { bslEngine } : {}) });
const results = [];
let browser;
try {
  browser = await startChrome(executable, { forwardAssets: flags.includes("--fetch-assets-via-node") });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(origin)).ok) break; } catch {} await new Promise(resolve => setTimeout(resolve, 200)); }
  for (const row of rows) {
    // Fresh page, tracker and worker per recording: no signer or prediction state leaks between clips.
    await browser.send("Page.navigate", { url: `${origin}/__qa/recognition-lab.html?${query}` });
    for (let i = 0; i < 100 && !(await browser.evaluate("!!window.signrelayLab")); i++) await new Promise(resolve => setTimeout(resolve, 100));
    const fields = { language: "bsl", participant: row.signer_id.replace(/[^\w.-]/g, "-").slice(0, 64),
      "trial-type": row.category === "supported" ? "sign" : row.category === "non_sign" ? "no_sign" : "unknown_sign",
      expected: row.expected_gloss ?? "", split: "development", provenance: `${row.source} ${row.license}` };
    await browser.evaluate(`(() => { for (const [id, value] of Object.entries(${JSON.stringify(fields)})) document.getElementById(id).value = value;
      document.getElementById('mirror-input').checked = false; })()`);
    if (traceDir) await browser.evaluate("window.__trace = []; window.signrelayLab.setTraceObserver(event => { if (event.type === 'frame') window.__trace.push(event.frame); })");
    const document = await browser.send("DOM.getDocument");
    const { nodeId } = await browser.send("DOM.querySelector", { nodeId: document.root.nodeId, selector: "#file" });
    await browser.send("DOM.setFileInputFiles", { nodeId, files: [path.resolve(row.file)] });
    let trial;
    try {
      trial = await browser.evaluate("window.signrelayLab.evaluateFile(document.getElementById('file').files[0])");
    } catch (error) {
      trial = { status: "error", errors: [String(error)] };
    }
    if (traceDir) await writeFile(path.join(traceDir, `${row.recording_sha256}.json`), JSON.stringify({
      trial_id: row.trial_id, recording_sha256: row.recording_sha256, frames: await browser.evaluate("window.__trace") }));
    const result = { trial_id: row.trial_id, category: row.category, expected_gloss: row.expected_gloss ?? null, signer_id: row.signer_id,
      cohort: row.cohort, tags: row.tags ?? [], status: trial.status, errors: trial.errors ?? [],
      suggested: trial.suggested_glosses ?? [], confirmed: (trial.accepted_glosses ?? []), confirmed_sources: trial.confirmed_sources ?? [],
      suggestion_times_ms: trial.suggestion_times_ms ?? [], decisions: trial.bsl_decisions ?? [],
      frames: trial.frames, hand_frames: trial.hand_frames, handedness_counts: trial.handedness_counts,
      source_duration_s: trial.source_duration_s, duration_ms: trial.duration_ms };
    results.push(result);
    console.log(JSON.stringify({ trial: row.trial_id, expected: row.expected_gloss, suggested: result.suggested, confirmed: result.confirmed,
      top: result.decisions.map(decision => decision.top5?.[0]?.label), frames: result.frames, hands: result.hand_frames, status: result.status }));
  }
  const report = {
    scope: "Licensed recordings replayed as unique decoded frames (≤20 Hz) through the production tracker and worker in headless Chromium. Not physical-camera evidence.",
    manifest: manifestFile, manifest_sha256: await sha(manifestFile), worker: workerVariant, worker_sha256: workerSha, bsl_engine: bslEngine ?? "worker-default",
    source_commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    tree_dirty: Boolean(execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], { encoding: "utf8" }).trim()),
    browser: execFileSync(executable, ["--version"], { encoding: "utf8" }).trim(), browser_errors: browser.errors,
    summary: scoreBslTrials(results), trials: results,
  };
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify(report.summary, null, 2));
  if (results.some(result => result.status !== "complete")) process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
}
