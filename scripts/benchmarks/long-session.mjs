// Long-running session stress on real Node worker threads (the browser Worker
// protocol, not a browser or phone measurement). The committed recognition
// worker logic is bundled from source; the committed template-matching bundle
// in public/workers is used unchanged. Camera delivery follows the app's
// one-in-flight / one-latest protocol at 20 Hz, so a slow worker shows up as
// coalesced (dropped) frames and queue age, never as an unbounded queue.
//
//   LONG_SESSION_SECONDS=120 node scripts/benchmarks/long-session.mjs [--out docs/gitex/sprint-2/long-session-benchmark.json]
import { build } from "esbuild";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { cpus, tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { ThreadWorker } from "./worker-host.mjs";

const root = process.cwd();
const seconds = Number(process.env.LONG_SESSION_SECONDS ?? 120);
const outIndex = process.argv.indexOf("--out");
const out = outIndex > 0 ? process.argv[outIndex + 1] : null;
const temporary = await mkdtemp(path.join(tmpdir(), "signrelay-long-"));
const quantile = (values, q) => values.length ? +[...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * q))].toFixed(2) : null;
try {
  const bundle = (entry, output) => build({ entryPoints: [entry], outfile: output, absWorkingDir: root, bundle: true, format: "esm",
    platform: "node", target: "node22", nodePaths: [path.join(root, "node_modules")], logLevel: "error" });
  const workerScript = path.join(temporary, "recognition-worker.mjs"), workload = path.join(temporary, "workload.mjs");
  await bundle("workers/recognition.worker.ts", workerScript);
  await bundle("scripts/benchmarks/matching-workload.ts", workload);
  const { makeSign, examples } = await import(pathToFileURL(workload).href);
  // A repeating signing session: six signs with rests, as at a demo booth.
  const cycle = ["HELLO", "THANK YOU", "PLEASE", "SORRY", "YES", "NO"].flatMap(sign => [
    ...makeSign(sign, { duration: 1000, count: 21 }), ...Array.from({ length: 14 }, () => ({ timestamp: 0, hands: [], face: [], pose: [] }))]);
  const scenarios = [
    { name: "30 personal examples", language: "csl", templates: examples(30) },
    { name: "150 personal examples", language: "csl", templates: examples(150) },
    { name: "300 personal examples", language: "csl", templates: examples(300) },
    { name: "775 PSL references", language: "psl", templates: [] },
  ];
  const results = [];
  // LONG_SESSION_ONLY="300 personal examples" runs one scenario (for longer memory checks).
  for (const scenario of scenarios.filter(item => !process.env.LONG_SESSION_ONLY || item.name === process.env.LONG_SESSION_ONLY)) {
    const worker = new ThreadWorker(workerScript, root); await worker.ready;
    const latency = [], queueAge = [], heap = [], rss = [], faults = [];
    let id = 0, inFlight = null, latest = null, offered = 0, sent = 0, coalesced = 0, acknowledged = 0, heapResolve = null;
    const confirmed = {};
    const pump = () => {
      if (inFlight || !latest) return;
      const { frame, queuedAt } = latest; latest = null; id++;
      inFlight = { id, sentAt: performance.now() }; queueAge.push(inFlight.sentAt - queuedAt); sent++;
      worker.postMessage({ type: "frame", frame, frameId: id, session: 1 });
    };
    worker.onmessage = ({ data }) => {
      if (data.type === "__heap") { heapResolve?.(data.used); return; }
      if (data.type === "fault") faults.push(data.message);
      if (data.type === "confirmed") confirmed[`${data.source}:${data.gloss}`] = (confirmed[`${data.source}:${data.gloss}`] ?? 0) + 1;
      if (data.type !== "analysis" || data.frameId !== inFlight?.id) return;
      const ms = performance.now() - inFlight.sentAt;
      latency.push({ t: (performance.now() - started) / 1000, ms }); acknowledged++; inFlight = null; pump();
    };
    worker.postMessage({ type: "templates", language: scenario.language, templates: scenario.templates, session: 1 });
    const started = performance.now();
    let frameTime = 1000, next = performance.now(), sampleAt = 0;
    while (performance.now() - started < seconds * 1000) {
      const source = cycle[offered % cycle.length];
      frameTime += 50;
      const frame = { ...source, timestamp: frameTime, hands: source.hands.map(hand => ({ ...hand })) };
      if (latest) coalesced++;
      latest = { frame, queuedAt: performance.now() }; offered++; pump();
      if (performance.now() - started >= sampleAt) {
        sampleAt += Number(process.env.LONG_SESSION_SAMPLE_MS ?? 10000);
        const used = await Promise.race([new Promise(resolve => { heapResolve = resolve; worker.postMessage({ type: "__heap" }); }), delay(2000).then(() => null)]);
        heap.push({ t: Math.round((performance.now() - started) / 1000), worker_heap_mb: used === null ? null : +(used / 1048576).toFixed(1) });
        rss.push({ t: Math.round((performance.now() - started) / 1000), process_rss_mb: +(process.memoryUsage().rss / 1048576).toFixed(1) });
      }
      next += 50; await delay(Math.max(0, next - performance.now()));
    }
    const deadline = performance.now() + 5000;
    while ((inFlight || latest) && performance.now() < deadline) await delay(10);
    worker.postMessage({ type: "reset", session: 2 }); worker.terminate();
    const window = (from, to) => latency.filter(sample => sample.t >= from && sample.t < to).map(sample => sample.ms);
    const firstHeap = heap.find(h => h.worker_heap_mb !== null)?.worker_heap_mb, lastHeap = heap.findLast(h => h.worker_heap_mb !== null)?.worker_heap_mb;
    results.push({ scenario: scenario.name, seconds, offered, sent, acknowledged, coalesced_dropped: coalesced, faults, confirmed,
      ack_latency_ms: { p50: quantile(latency.map(s => s.ms), 0.5), p95: quantile(latency.map(s => s.ms), 0.95), max: quantile(latency.map(s => s.ms), 1) },
      max_at_s: latency.length ? +latency.reduce((a, b) => b.ms > a.ms ? b : a).t.toFixed(2) : null,
      over_50ms: latency.filter(sample => sample.ms > 50).map(sample => ({ t: +sample.t.toFixed(2), ms: +sample.ms.toFixed(1) })),
      first_30s_p95_ms: quantile(window(0, 30), 0.95), last_30s_p95_ms: quantile(window(seconds - 30, seconds + 1), 0.95),
      queue_age_ms: { p50: quantile(queueAge, 0.5), p95: quantile(queueAge, 0.95), max: quantile(queueAge, 1) },
      worker_heap_mb: { first: firstHeap, last: lastHeap, max: Math.max(...heap.map(h => h.worker_heap_mb ?? 0)) }, heap_samples: heap, rss_samples: rss });
    console.log(JSON.stringify(results.at(-1), (key, value) => key.endsWith("_samples") ? undefined : value));
  }
  const report = { schema: 1, benchmark: "long-session", environment: `Node ${process.version}, ${cpus()[0]?.model ?? "unknown CPU"} x${cpus().length}, real worker threads, local files; not a browser, camera or phone measurement`,
    protocol: "20 Hz offered frames, one in flight and one latest (coalescing), six-sign cycle with rests", results };
  if (out) await writeFile(out, JSON.stringify(report, null, 2) + "\n");
} finally { await rm(temporary, { recursive: true, force: true }); }
