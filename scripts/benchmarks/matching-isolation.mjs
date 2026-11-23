import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { ThreadWorker } from "./worker-host.mjs";

const root = process.cwd();
const temporary = await mkdtemp(path.join(tmpdir(), "signrelay-match-"));
const baseline = process.env.BENCHMARK_BASELINE_REF ?? "84e239e9a9a9b1423831c7560af39f050f158f8b";
try {
  // Materialise source only. Models remain the exact same installed bytes.
  const oldRoot = path.join(temporary, "baseline");
  const files = execFileSync("git", ["ls-tree", "-r", "--name-only", baseline, "lib", "workers", "tsconfig.json"], { encoding: "utf8" }).trim().split("\n");
  for (const file of files) {
    await mkdir(path.dirname(path.join(oldRoot, file)), { recursive: true });
    await writeFile(path.join(oldRoot, file), execFileSync("git", ["show", `${baseline}:${file}`]));
  }
  await symlink(path.join(root, "public"), path.join(oldRoot, "public"));
  const bundle = async (entry, output, cwd = root) => build({ entryPoints: [entry], outfile: output,
    absWorkingDir: cwd, bundle: true, format: "esm", platform: "node", target: "node22",
    nodePaths: [path.join(root, "node_modules")], logLevel: "error" });
  const currentWorker = path.join(temporary, "current-worker.mjs"), oldWorker = path.join(temporary, "old-worker.mjs");
  await bundle("workers/recognition.worker.ts", currentWorker);
  await bundle("workers/recognition.worker.ts", oldWorker, oldRoot);
  const workload = path.join(temporary, "workload.mjs");
  await bundle("scripts/benchmarks/matching-workload.ts", workload);
  const { makeSign, examples, recognizePsl776 } = await import(pathToFileURL(workload).href);
  await bundle("workers/template-matching.worker.ts", path.join(root, "public/workers/template-matching.worker.js"));
  const quantile = (values, q) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * q))];
  for (const count of [30, 150, 300]) for (const [version, script] of [["pr21", oldWorker], ["isolated", currentWorker]]) {
    const worker = new ThreadWorker(script, root); await worker.ready;
    const times = [], posted = new Map(); let id = 0, waiting = false, queued = null, sent = 0;
    const pump = () => {
      if (waiting || !queued) return;
      const frame = queued; queued = null; waiting = true; id++;
      posted.set(id, performance.now()); sent++;
      worker.postMessage({ type: "frame", frame, frameId: id, session: 1 });
    };
    worker.onmessage = ({ data }) => {
      if (data.type === "fault") throw new Error(data.message);
      if (data.type !== "analysis") return;
      times.push(performance.now() - posted.get(data.frameId)); waiting = false; pump();
    };
    worker.postMessage({ type: "templates", language: "csl", templates: examples(count), session: 1 });
    const sample = makeSign("HELLO", { duration: 3950, count: 80 });
    for (const frame of sample) { queued = frame; pump(); await delay(50); }
    const deadline = performance.now() + 5000;
    while ((waiting || queued) && performance.now() < deadline) await delay(10);
    worker.postMessage({ type: "reset", session: 2 }); worker.terminate();
    console.log(JSON.stringify({ benchmark: "frame-ack-real-threads", version, examples: count, offered: sample.length,
      acknowledged: times.length, sent, median_ms: +quantile(times, 0.5).toFixed(2),
      p95_ms: +quantile(times, 0.95).toFixed(2), max_ms: +Math.max(...times).toFixed(2) }));
  }
  for (const [version, script] of [["pr21", oldWorker], ["isolated", currentWorker]]) {
    const worker = new ThreadWorker(script, root); await worker.ready;
    const times = [], posted = new Map(); let id = 0, waiting = false, queued = null;
    const pump = () => {
      if (waiting || !queued) return;
      const frame = queued; queued = null; waiting = true; id++;
      posted.set(id, performance.now());
      worker.postMessage({ type: "frame", frame, frameId: id, session: 1 });
    };
    worker.onmessage = ({ data }) => {
      if (data.type === "fault") throw new Error(data.message);
      if (data.type !== "analysis") return;
      times.push(performance.now() - posted.get(data.frameId)); waiting = false; pump();
    };
    worker.postMessage({ type: "templates", language: "psl", templates: [], session: 1 });
    const sample = makeSign("HELLO", { duration: 3950, count: 80 });
    for (const frame of sample) { queued = frame; pump(); await delay(50); }
    const deadline = performance.now() + 5000;
    while ((waiting || queued) && performance.now() < deadline) await delay(10);
    worker.terminate();
    console.log(JSON.stringify({ benchmark: "psl-frame-ack-real-threads", version, references: 775,
      offered: sample.length, acknowledged: times.length, median_ms: +quantile(times, 0.5).toFixed(2),
      p95_ms: +quantile(times, 0.95).toFixed(2), max_ms: +Math.max(...times).toFixed(2) }));
  }
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => typeof url === "string" && url.startsWith("/models/")
    ? new Response(await readFile(path.join(root, "public", url))) : originalFetch(url);
  const oldPslPath = path.join(temporary, "old-psl.mjs");
  await bundle("lib/psl776-runtime.ts", oldPslPath, oldRoot);
  const oldPsl = (await import(pathToFileURL(oldPslPath).href)).recognizePsl776;
  const sample = makeSign("HELLO", { duration: 1800, count: 37 });
  let expected;
  for (const [version, scan] of [["pr21", oldPsl], ["isolated", recognizePsl776]]) {
    const durations = []; let maxGap = 0, last = performance.now();
    const heartbeat = setInterval(() => { const now = performance.now(); maxGap = Math.max(maxGap, now - last); last = now; }, 5);
    try {
      for (let i = 0; i < 6; i++) {
        const start = performance.now(); const prediction = await scan(sample); durations.push(performance.now() - start);
        if (version === "pr21") expected = prediction;
        else if (JSON.stringify(prediction) !== JSON.stringify(expected)) throw new Error("PSL decision changed");
      }
    } finally { clearInterval(heartbeat); }
    console.log(JSON.stringify({ benchmark: "actual-775-psl-local-assets", version, cold_ms: +durations[0].toFixed(2),
      warm_median_ms: +quantile(durations.slice(1), 0.5).toFixed(2), max_event_loop_gap_ms: +maxGap.toFixed(2),
      prediction: expected?.label ?? null, decision_equal: true, network: "local file bytes, not connection speed" }));
  }
} finally { await rm(temporary, { recursive: true, force: true }); }
