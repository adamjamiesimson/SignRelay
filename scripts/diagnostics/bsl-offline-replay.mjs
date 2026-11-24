// Replay captured landmark traces through the real recognition worker and the
// real BSL-1K ONNX model in Node, so worker/input variants can be compared on
// *identical* tracker observations (tracker noise removed from the comparison).
//
// node scripts/diagnostics/bsl-offline-replay.mjs <manifest.json> <traces-dir> <output.json>
//   [--bsl-engine=legacy|v2] [--worker-source=path/to/recognition.worker.ts] [--speed=1]
//
// Frames are delivered at their recorded camera timestamps (scaled by --speed),
// so model latency and staleness rules behave as in the browser.
import { build } from "esbuild";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { scoreBslTrials } from "./bsl-scoring.mjs";

const [manifestFile, traceDir, output, ...flags] = process.argv.slice(2);
if (!manifestFile || !traceDir || !output) throw new Error("Supply manifest JSON, trace directory and output JSON");
const option = name => flags.find(flag => flag.startsWith(`--${name}=`))?.slice(name.length + 3);
const engine = option("bsl-engine");
const workerSource = path.resolve(option("worker-source") ?? "workers/recognition.worker.ts");
const speed = Number(option("speed") ?? 1);
const root = path.resolve(path.dirname(workerSource), "..");

const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
const rows = Array.isArray(manifest) ? manifest : manifest.trials;
// Inside the ignored export directory so the external onnxruntime-web resolves from node_modules.
await mkdir("out", { recursive: true });
const temp = await mkdtemp(path.resolve("out/.bsl-replay-"));
const bundle = path.join(temp, "worker.mjs");
await build({ entryPoints: [workerSource], bundle: true, format: "esm", platform: "node", target: "node22", outfile: bundle, external: ["onnxruntime-web"],
  alias: { "@": root }, nodePaths: [path.resolve("node_modules")], logLevel: "error" });

// Browser globals the worker expects. Model files are served from public/.
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (url.startsWith("/")) return new Response(await readFile(path.resolve("public" + url.split("?")[0])), { status: 200 });
  return realFetch(input, init);
};
const ort = await import("onnxruntime-web");
ort.env.wasm.numThreads = 1;
const messages = [];
globalThis.self = { postMessage: message => messages.push({ ...message, at: performance.now() }) };
await import(pathToFileURL(bundle).href);
const worker = globalThis.self;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const results = [];
for (const row of rows) {
  let trace;
  try { trace = JSON.parse(await readFile(path.join(traceDir, `${row.recording_sha256}.json`), "utf8")); }
  catch { console.error(`No trace for ${row.trial_id}; capture it with run-bsl-video-evaluation.mjs --traces`); continue; }
  messages.length = 0;
  await worker.onmessage({ data: { type: "templates", language: "bsl", templates: [], diagnostics: true, ...(engine ? { bslEngine: engine } : {}) } });
  const frames = trace.frames;
  const t0 = performance.now(), c0 = frames[0]?.timestamp ?? 0;
  for (const frame of frames) {
    const due = (frame.timestamp - c0) / speed - (performance.now() - t0);
    if (due > 0) await sleep(due);
    await worker.onmessage({ data: { type: "frame", frame } });
  }
  await sleep(1500 / speed); // let a final inference finish, as the lab's settle period does
  const analyses = messages.filter(message => message.type === "analysis");
  const decisions = [];
  let seen = 0;
  for (const analysis of analyses) {
    const diagnostics = analysis.bslDiagnostics;
    if (!diagnostics?.lastDecision) continue;
    const total = Object.values(diagnostics.decisions).reduce((sum, count) => sum + count, 0);
    if (total > seen) { seen = total; const decision = { ...diagnostics.lastDecision }; delete decision.ageMs; decisions.push(decision); }
  }
  results.push({ trial_id: row.trial_id, category: row.category, expected_gloss: row.expected_gloss ?? null, signer_id: row.signer_id,
    cohort: row.cohort, tags: row.tags ?? [], status: "complete", errors: [],
    suggested: messages.filter(message => message.type === "suggestion").map(message => message.gloss),
    confirmed: messages.filter(message => message.type === "confirmed").map(message => message.gloss),
    decisions, frames: frames.length, hand_frames: frames.filter(frame => frame.hands.length).length });
  console.log(JSON.stringify({ trial: row.trial_id, expected: row.expected_gloss, suggested: results.at(-1).suggested,
    confirmed: results.at(-1).confirmed, top: decisions.map(decision => decision.top5?.[0]?.label) }));
  await worker.onmessage({ data: { type: "reset" } });
}
await rm(temp, { recursive: true, force: true });
const report = { scope: "Offline replay of captured tracker observations through the real worker and ONNX model (Node, WASM).",
  manifest: manifestFile, worker_source: path.relative(process.cwd(), workerSource), bsl_engine: engine ?? "worker-default", speed,
  summary: scoreBslTrials(results), trials: results };
await writeFile(output, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify(report.summary.all, (key, value) => key === "per_trial" ? undefined : value, 2));
process.exit(0);
