// Requires npm run build:firebase. No physical camera or external runtime assets.
// node tests/landmark-lifecycle-browser-smoke.mjs /path/to/chrome
import { build } from "esbuild";
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { startChrome } from "../scripts/diagnostics/chrome-session.mjs";

const executable = process.argv[2];
if (!executable) throw new Error("Supply Chrome executable");
const port = 18000 + Math.floor(Math.random() * 1000), origin = `http://127.0.0.1:${port}`;
const probe = "out/workers/landmark-lifecycle-probe.js";
const server = spawn(process.execPath, ["scripts/serve-export.mjs", "--port", String(port)], { stdio: "ignore" });
let browser;
try {
  await build({ entryPoints: ["tests/landmark-lifecycle-browser-probe.ts"], outfile: probe,
    bundle: true, format: "esm", platform: "browser", target: "es2020" });
  browser = await startChrome(executable);
  await browser.send("Page.navigate", { url: origin });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (await browser.evaluate("!!document.querySelector('main')")) { ready = true; break; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error("Static page did not load");
  const result = await browser.evaluate(`new Promise((resolve,reject) => {
    const worker = new Worker('/workers/landmark-lifecycle-probe.js', {type:'module'});
    const timer = setTimeout(() => {worker.terminate();reject(new Error('Browser model lifecycle timeout'));},120000);
    worker.onerror = event => {clearTimeout(timer);worker.terminate();reject(new Error(event.message));};
    worker.onmessage = event => {clearTimeout(timer);worker.terminate();resolve(event.data);};
    worker.postMessage({});
  })`);
  console.log(JSON.stringify(result));
  if (!result.passed) throw new Error(result.error);
} finally { await browser?.close(); server.kill(); await rm(probe, { force: true }); }
