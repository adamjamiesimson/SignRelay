// Paired real MediaPipe worker timing with generated RGB, no camera or signer data.
// Run after installing the pinned vision assets and building the vision worker.
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { cpus, platform } from "node:os";
import { resolve, sep } from "node:path";
import { build } from "esbuild";
import { startChrome } from "../diagnostics/chrome-session.mjs";

const [chrome, baseline, output] = process.argv.slice(2);
if (!chrome || !baseline || !output) throw new Error("Usage: node scripts/benchmarks/alpha-tracking-paired.mjs <chrome> <baseline SHA> <output.json>");
const frozen = execFileSync("git", ["show", `${baseline}:lib/live-vision.ts`], { encoding: "utf8" });
const source = await build({ bundle: true, write: false, format: "esm", stdin: { loader: "ts", resolveDir: process.cwd(), contents: `
  import { LiveVision as Baseline } from "baseline-live-vision";
  import { LiveVision as Candidate } from "./lib/live-vision";
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const canvas = document.createElement("canvas");
  const overlay = document.createElement("canvas");
  canvas.width = overlay.width = 640; canvas.height = overlay.height = 480;
  const input = canvas.getContext("2d"), draw = overlay.getContext("2d");
  const summarize = values => {
    const sorted = values.slice().sort((a, b) => a - b);
    const percentile = q => sorted[Math.ceil(q * sorted.length) - 1];
    return { count: values.length, median: percentile(.5), p95: percentile(.95), max: sorted.at(-1) };
  };
  window.runTracking = async (version, accelerated) => {
    const Tracker = version === "baseline" ? Baseline : Candidate;
    const starting = performance.now();
    const tracker = await Tracker.create(undefined, accelerated);
    const startupMs = performance.now() - starting;
    try {
      if (tracker.assetSource !== "self-hosted") throw new Error("Expected pinned self-hosted assets");
      const stages = { capture: [], hands: [], auxiliary: [], overlay: [], full: [] };
      let firstFrameMs;
      for (let i = 0; i < 29; i++) {
        input.fillStyle = "#20242c"; input.fillRect(0, 0, 640, 480);
        input.fillStyle = "#f0c8a0"; input.fillRect(i * 17 % 460, 160, 100, 160);
        const start = performance.now();
        let overlayMs;
        const frame = await tracker.process(canvas, start, result => {
          draw.clearRect(0, 0, 640, 480);
          for (const hand of result.hands) for (const point of hand.landmarks) {
            draw.fillRect(point.x * 640, point.y * 480, 2, 2);
          }
          overlayMs = performance.now() - start;
        });
        if (!frame || overlayMs === undefined) throw new Error("Tracking did not complete");
        const fullMs = performance.now() - start;
        firstFrameMs ??= fullMs;
        if (i >= 5) {
          stages.overlay.push(overlayMs); stages.full.push(fullMs);
          for (const stage of ["capture", "hands", "auxiliary"]) stages[stage].push(tracker.timings[stage]);
        }
        await wait(33);
      }
      return { version, accelerated, delegate: tracker.delegate, mode: tracker.mode, startupMs, firstFrameMs,
        lastError: tracker.lastError, stages: Object.fromEntries(Object.entries(stages).map(([key, values]) => [key, summarize(values)])) };
    } finally { tracker.close(); }
  };
` }, plugins: [{ name: "alpha-baseline", setup(plugin) {
  plugin.onResolve({ filter: /^baseline-live-vision$/ }, () => ({ path: "live-vision.ts", namespace: "alpha-baseline" }));
  plugin.onLoad({ filter: /.*/, namespace: "alpha-baseline" }, () => ({ contents: frozen, loader: "ts", resolveDir: resolve("lib") }));
} }] });

const publicRoot = resolve("public");
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  if (pathname === "/") return response.writeHead(200, { "Content-Type": "text/html" }).end('<script type="module" src="/bench.js"></script>');
  if (pathname === "/bench.js") return response.writeHead(200, { "Content-Type": "text/javascript" }).end(source.outputFiles[0].contents);
  const path = resolve(publicRoot, `.${pathname}`);
  if (!(pathname.startsWith("/vision/") || pathname === "/workers/vision.worker.js") || !path.startsWith(publicRoot + sep)) {
    response.writeHead(404).end(); return;
  }
  const mime = path.endsWith(".js") ? "text/javascript" : path.endsWith(".wasm") ? "application/wasm" : "application/octet-stream";
  try { const bytes = await readFile(path); response.writeHead(200, { "Content-Type": mime }).end(bytes); }
  catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await startChrome(chrome, { proxy: "http://127.0.0.1:9" });
  await browser.send("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/` });
  for (let i = 0; i < 100 && !await browser.evaluate('typeof window.runTracking === "function"'); i++) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const report = { baseline, browser: await browser.send("Browser.getVersion"), cpu: cpus()[0]?.model, platform: platform(),
    workload: "Generated 640×480 RGB, one outstanding frame, 33 ms between completed frames. Per run: 5 warm-up, 24 measured; cold tracker with warm HTTP cache possible.", runs: [] };
  for (const accelerated of [false, true]) for (let run = 0; run < 3; run++) {
    for (const version of run % 2 ? ["candidate", "baseline"] : ["baseline", "candidate"]) {
      const result = await browser.evaluate(`window.runTracking(${JSON.stringify(version)}, ${accelerated})`);
      report.runs.push({ run: run + 1, ...result });
      await writeFile(output, JSON.stringify(report, null, 2) + "\n");
    }
  }
} finally {
  try { await browser?.close(); } finally { server.closeAllConnections(); server.close(); }
}
