// Production-release isolation on the REAL production export (npm run
// build:firebase, profile "full", fingerspelling off). Unlike
// release-flag-smoke.mjs this needs no rehearsal hook: it starts real
// MediaPipe word-mode vision with Chrome's synthetic camera and checks the
// shipped artifact and the running page, not source conditionals.
//   node tests/production-release-smoke.mjs <chrome>
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { startChrome } from "../scripts/diagnostics/chrome-session.mjs";
import { observeWorkerNetwork } from "../scripts/diagnostics/worker-network.mjs";
import { RETURNING_VISITOR } from "./helpers/returning-visitor.mjs";
import { FINGERSPELLING_ASSETS } from "../lib/release-flags.mjs";

const executable = process.argv[2];
if (!executable) throw new Error("usage: node tests/production-release-smoke.mjs <chrome> (after npm run build:firebase)");
const manifest = JSON.parse(readFileSync("out/runtime-manifest.json", "utf8"));
assert.equal(manifest.profile, "full", "run against the production (full) export");
assert.equal(manifest.fingerspelling, "off", "production export was built with fingerspelling on");
assert.equal(manifest.fingerspelling_ui_compiled, false, "production client contains the fingerspelling workspace");

const port = 19200 + Math.floor(Math.random() * 400), origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["scripts/serve-export.mjs", "--port", String(port)], { stdio: "ignore" });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, reason, attempts = 600) {
  for (let i = 0; i < attempts; i++) { if (await check()) return; await pause(100); }
  throw new Error(reason);
}
const checks = [];
let browser;
try {
  await until(async () => { try { return (await fetch(origin)).ok; } catch { return false; } }, "No static server");
  // 1. The research files are not served at all.
  const { modelDir, workers } = FINGERSPELLING_ASSETS;
  for (const path of [`/${modelDir}/fsboard-accuracy-v2.onnx`, `/${modelDir}/fsboard-upright-v1.onnx`, `/${modelDir}/fsboard-pilot-v1.onnx`, ...workers.map(w => `/workers/${w}`)]) {
    const status = (await fetch(origin + path)).status;
    assert.equal(status, 404, `${path} is served (${status})`);
    assert.equal(existsSync(`out${path}`), false, `${path} is in the export`);
  }
  checks.push("research models and workers absent from the export and not served (404)");

  browser = await startChrome(executable);
  const network = await observeWorkerNetwork(browser);
  const requests = [];
  browser.onEvent(message => { if (message.method === "Network.requestWillBeSent") requests.push(message.params.request.url); });
  await browser.send("Network.enable");
  await browser.send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
    window.__qaWorkers = []; window.__qaTracks = [];
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker { constructor(url, options) { window.__qaWorkers.push(String(url)); super(url, options); } };
    const get = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async options => { const stream = await get(options); window.__qaTracks.push(...stream.getTracks()); return stream; };
  })();` });
  await browser.send("Page.addScriptToEvaluateOnNewDocument", { source: RETURNING_VISITOR });
  const evaluate = browser.evaluate;
  const click = text => evaluate(`(() => { const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}); if(!b||b.disabled) throw new Error('Missing button '+${JSON.stringify(text)}); b.click(); })()`);
  const hasText = text => evaluate(`document.body.innerText.includes(${JSON.stringify(text)})`);

  // 2. A deep link naming the research mode is inert.
  await browser.send("Page.navigate", { url: `${origin}/?perf&mode=fingerspelling&asl=fingerspelling#fingerspelling` });
  await until(() => evaluate("!!document.querySelector('.language-row [role=radio]')"), "Welcome screen missing");
  const choose = name => evaluate(`[...document.querySelectorAll('[role=radio]')].find(b=>b.textContent.includes(${JSON.stringify(name)}))?.click()`);
  const checked = name => evaluate(`document.querySelector('[role=radio][aria-checked=true]')?.textContent.includes(${JSON.stringify(name)})`);
  await until(async () => { await choose("British"); return checked("British"); }, "Welcome screen did not hydrate", 100);
  await choose("American");
  await until(() => checked("American"), "ASL selection failed", 100);
  assert.equal(await hasText("Fingerspelling"), false, "welcome/onboarding mentions the research mode");
  await click("Start signing");
  await until(() => evaluate("document.querySelector('.status-badge')?.textContent === 'Active'"), "ASL word vision did not start");
  await pause(2500);
  assert.equal(await evaluate("!!document.querySelector('.asl-mode-selector')"), false, "mode selector rendered");
  assert.equal(await evaluate("!!document.querySelector('#spelling-text')"), false, "spelling workspace rendered");
  assert.equal(await evaluate("[...document.querySelectorAll('button')].some(b => /fingerspell/i.test(b.textContent))"), false, "a fingerspelling control is rendered");
  assert.equal(await hasText("Fingerspelling"), false, "workspace mentions the research mode");
  checks.push("ASL workspace (real word-mode vision, synthetic camera) with a fingerspelling deep link: no selector, panel or control");

  // 3. Nothing research-related was created or requested.
  const created = await evaluate("window.__qaWorkers");
  assert.ok(created.some(url => url.includes("vision.worker.js")), `word-mode vision worker not created: ${created}`);
  assert.ok(!created.some(url => /fingerspelling/.test(url)), `fingerspelling worker created: ${created}`);
  assert.deepEqual(network.failures, [], "worker network instrumentation failed");
  // requests includes worker-target requests (observeWorkerNetwork attaches to every worker).
  const research = requests.filter(url => /asl-fingerspelling|fingerspelling(-vision)?\.worker/.test(String(url)));
  assert.deepEqual(research, [], "research assets were requested");
  checks.push(`workers created: ${[...new Set(created.map(u => u.replace(/^.*\/workers\//, "")))].join(", ")}; no fingerspelling worker, model or worker-script request`);

  // 4. Camera controls still release the camera.
  await click("Pause camera");
  await until(() => evaluate("window.__qaTracks.length > 0 && window.__qaTracks.every(t => t.readyState === 'ended')"), "Camera tracks were not released");
  checks.push("pause releases every camera track");
  const external = requests.filter(url => { try { const u = new URL(url); return !["127.0.0.1", "localhost"].includes(u.hostname) && u.protocol.startsWith("http"); } catch { return false; } });
  assert.deepEqual(external, [], "unexpected external requests");
  checks.push("no external requests");
  console.log("PRODUCTION-RELEASE-SMOKE", JSON.stringify({ passed: checks.length, checks, manifest: { profile: manifest.profile, fingerspelling: manifest.fingerspelling, fingerspelling_ui_compiled: manifest.fingerspelling_ui_compiled } }));
} finally { await browser?.close(); server.kill(); }
