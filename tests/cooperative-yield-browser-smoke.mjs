// Cooperative yielding in a real browser worker: page messages and worker
// timers run between ASL-2000 slices, and page or timer cancellation aborts
// inference. Serves public/ directly; no export build is needed.
//   node tests/cooperative-yield-browser-smoke.mjs /path/to/chrome
import { build } from "esbuild";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { startChrome } from "../scripts/diagnostics/chrome-session.mjs";

const executable = process.argv[2];
if (!executable) throw new Error("Usage: node tests/cooperative-yield-browser-smoke.mjs <chrome>");
const bundle = await build({ entryPoints: ["tests/cooperative-yield-browser-probe.ts"], bundle: true, write: false,
  format: "esm", platform: "browser", target: "es2020", alias: { "@": "." } });
const probe = bundle.outputFiles[0].contents;
const root = resolve("public");
const types = { ".js": "text/javascript", ".json": "application/json", ".bin": "application/octet-stream" };
const server = createServer(async (request, response) => {
  const path = new URL(request.url, "http://localhost").pathname;
  if (path === "/") { response.setHeader("Content-Type", "text/html"); response.end("<!doctype html><title>probe</title>"); return; }
  if (path === "/probe.js") { response.setHeader("Content-Type", "text/javascript"); response.end(probe); return; }
  const file = resolve(root, "." + path);
  if (!file.startsWith(root + sep)) { response.writeHead(403).end(); return; }
  try { response.setHeader("Content-Type", types[extname(file)] ?? "application/octet-stream"); response.end(await readFile(file)); }
  catch { response.writeHead(404).end(); }
});
await new Promise(ready => server.listen(0, "127.0.0.1", ready));
let browser;
try {
  browser = await startChrome(executable, { proxy: null });
  await browser.send("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/` });
  for (let i = 0; i < 100 && !await browser.evaluate("document.readyState === 'complete'"); i++) await new Promise(r => setTimeout(r, 100));
  const result = await browser.evaluate(`new Promise((resolve, reject) => {
    const worker = new Worker('/probe.js', { type: 'module' });
    let pinging;
    const timeout = setTimeout(() => { worker.terminate(); reject(new Error('Probe timed out')); }, 240000);
    worker.onerror = event => { clearTimeout(timeout); worker.terminate(); reject(new Error(event.message)); };
    worker.onmessage = ({ data }) => {
      if (data.type === 'ping-start') pinging = setInterval(() => worker.postMessage({ type: 'ping' }), 2);
      else if (data.type === 'ping-stop') clearInterval(pinging);
      else if (data.type === 'cancel-me') worker.postMessage({ type: 'cancel' });
      else if (data.type === 'result') { clearTimeout(timeout); clearInterval(pinging); worker.terminate(); resolve(data); }
    };
    worker.postMessage({ type: 'run' });
  })`);
  console.log(JSON.stringify({ ...result, environment: "headless Chromium worker; kinematic fixture, not sign accuracy" }));
  if (!result.passed) throw new Error(result.error);
} finally { await browser?.close(); server.close(); }
