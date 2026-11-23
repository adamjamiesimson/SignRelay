// Fault injection on the built export with Chromium's synthetic fake camera.
// Each fault must produce a clear message, release the camera when it cannot
// continue, keep the page usable and recover once the fault is removed:
// recognition worker crashes (bounded respawns, then a manual restart), a
// worker that fails to construct, missing and corrupted tracking models, and
// browser storage that throws. Software resilience only; not accuracy.
//   node tests/fault-injection-smoke.mjs /path/to/chrome
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { startChrome } from "../scripts/diagnostics/chrome-session.mjs";

const executable = process.argv[2];
if (!executable) throw new Error("Usage: node tests/fault-injection-smoke.mjs <chrome> (after building the export)");
const port = 18500 + Math.floor(Math.random() * 300), origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["scripts/serve-export.mjs", "--host", "127.0.0.1", "--port", String(port + 1000)], { stdio: "ignore" });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, reason, attempts = 300) {
  for (let i = 0; i < attempts; i++) { if (await check()) return; await pause(100); }
  throw new Error(reason);
}
let trackerFault = null, injectedTrackerFaults = 0;
// Inject at the real asset boundary. Worker Fetch-domain support varies across
// Chromium versions; a no-cache loopback relay exercises the identical bytes.
const relay = createServer(async (request, response) => {
  try {
    if (request.url.split("?")[0].endsWith("/hand_landmarker.task") && trackerFault) {
      injectedTrackerFaults++;
      response.writeHead(trackerFault === "missing" ? 404 : 200, { "Cache-Control": "no-store" });
      response.end(trackerFault === "missing" ? "Not found" : "corrupted model bytes");
      return;
    }
    const upstream = await fetch(`http://127.0.0.1:${port + 1000}${request.url}`);
    response.writeHead(upstream.status, { ...Object.fromEntries([...upstream.headers].filter(([key]) =>
      !["content-encoding", "content-length", "transfer-encoding"].includes(key))), "Cache-Control": "no-store" });
    response.end(Buffer.from(await upstream.arrayBuffer()));
  } catch { response.writeHead(502); response.end(); }
});
await new Promise(done => relay.listen(port, "127.0.0.1", done));
let browser;
const results = [];
try {
  await until(async () => { try { return (await fetch(origin)).ok; } catch { return false; } }, "No static server");
  browser = await startChrome(executable, { dismissOnboarding: true });
  const evaluate = browser.evaluate;
  await browser.send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
    window.__qa = { tracks: [], workers: [], frames: 0, failWorkers: 0 };
    if (sessionStorage.getItem('qa-storage-fails') === '1') {
      for (const method of ['setItem', 'getItem', 'removeItem']) Storage.prototype[method] = function () { throw new DOMException('Storage disabled for the test', 'SecurityError'); };
    }
    const get = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async options => { const stream = await get(options); window.__qa.tracks.push(...stream.getTracks()); return stream; };
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(url, options) {
        if (String(url).includes('recognition.worker') && window.__qa.failWorkers > 0) { window.__qa.failWorkers--; throw new Error('Injected worker construction failure'); }
        super(url, options); this.__url = String(url); this.__alive = true; window.__qa.workers.push(this);
      }
      terminate() { this.__alive = false; return super.terminate(); }
      postMessage(message, transfer) {
        if (this.__url.includes('recognition.worker') && message?.type === 'frame') window.__qa.frames++;
        return super.postMessage(message, transfer);
      }
    };
  })();` });
  const button = text => `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)})`;
  const click = text => evaluate(`(() => { const b=${button(text)}; if(!b||b.disabled) throw new Error('Missing button '+${JSON.stringify(text)}); b.click(); })()`);
  const has = text => evaluate(`!!${button(text)}`);
  const text = pattern => evaluate(`${pattern}.test(document.body.textContent)`);
  const active = () => evaluate("document.querySelector('.status-badge')?.textContent === 'Active'");
  const liveTracks = () => evaluate("window.__qa.tracks.filter(t => t.readyState === 'live').length");
  const frames = () => evaluate("window.__qa.frames");
  const analysing = async () => { const before = await frames(); await pause(800); return await frames() > before; };
  const crash = () => evaluate("(() => { const w = window.__qa.workers.filter(w => w.__alive && w.__url.includes('recognition.worker')).at(-1); w.onerror?.(new ErrorEvent('error', { message: 'Injected crash' })); })()");
  const open = async () => {
    await browser.send("Page.navigate", { url: `${origin}/?perf` });
    await until(() => evaluate("Object.keys(document.querySelector('[role=radio]') ?? {}).some(k=>k.startsWith('__reactFiber'))"), "Welcome screen did not hydrate");
    await click("Start signing");
  };

  // 1. Worker crashes: two automatic restarts per minute, then a manual restart.
  await open();
  await until(active, "Camera did not start");
  await until(analysing, "No frames analysed before the crash");
  for (let crashIndex = 1; crashIndex <= 2; crashIndex++) {
    await crash();
    await until(() => text("/Recognition was interrupted\\. Restarting/"), `Crash ${crashIndex} was not reported`);
    await until(analysing, `Recognition did not resume after crash ${crashIndex}`);
  }
  await crash();
  await until(() => has("Restart recognition"), "A third crash within a minute must pause recognition and offer a manual restart");
  assert.ok(await text("/paused after repeated interruptions/"));
  const created = await evaluate("window.__qa.workers.length");
  await pause(2000);
  assert.equal(await evaluate("window.__qa.workers.length"), created, "No automatic respawn after the limit");
  await click("Restart recognition");
  await until(analysing, "Manual restart did not resume recognition");
  assert.equal(await evaluate("window.__qa.workers.filter(w => w.__alive && w.__url.includes('recognition.worker')).length"), 1, "Exactly one live recognition worker after recovery");
  results.push({ fault: "recognition worker crash x3", automatic_restarts: 2, then: "paused with Restart recognition; manual restart recovered" });

  // 2. Worker construction fails once.
  await click("Change language");
  await evaluate("window.__qa.failWorkers = 1");
  await click("Start signing");
  await until(active, "Camera did not start after an injected construction failure");
  await until(analysing, "Recognition did not recover from a failed worker construction");
  results.push({ fault: "recognition worker fails to construct once", recovered: true });

  // 3. A missing local HandLandmarker model. The requests originate from
  // the dedicated worker, not the page's DevTools network session.
  await click("Pause camera");
  trackerFault = "missing";
  await open();
  await until(() => text("/tracking models could not load/"), "Missing model was not reported", 600);
  assert.equal(injectedTrackerFaults, 1, "Expected interception of the actual tracking worker's hand model request");
  assert.equal(await liveTracks(), 0, "The camera must be released when tracking cannot start");
  trackerFault = null;
  await click((await has("Retry camera")) ? "Retry camera" : "Start camera");
  await until(active, "Did not recover once the model was available", 600);
  results.push({ fault: "missing hand_landmarker.task", message: "tracking models could not load", camera_released: true, recovered: true });

  // 4. Corrupted tracking model bytes.
  await click("Pause camera");
  trackerFault = "corrupt";
  await open();
  await until(() => text("/tracking models could not load/"), "Corrupted model was not reported", 600);
  assert.equal(injectedTrackerFaults, 2, "Expected fingerprint verification against corrupted worker asset bytes");
  assert.equal(await liveTracks(), 0, "The camera must be released when the model is corrupted");
  trackerFault = null;
  await click((await has("Retry camera")) ? "Retry camera" : "Start camera");
  await until(active, "Did not recover once the model was intact", 600);
  results.push({ fault: "corrupted hand_landmarker.task", message: "tracking models could not load", camera_released: true, recovered: true });

  // 5. Browser storage throws on every access.
  await click("Pause camera");
  await evaluate("sessionStorage.setItem('qa-storage-fails', '1')");
  await open();
  await until(active, "Camera did not start with storage disabled");
  await until(analysing, "Recognition did not run with storage disabled");
  results.push({ fault: "localStorage throws", camera_and_recognition: "running" });

  const errors = browser.errors.filter(error => typeof error === "string" && !error.includes("Injected"));
  assert.deepEqual(errors, [], "Uncaught page exceptions");
  console.log(JSON.stringify({ passed: true, results, environment: "headless Chromium, synthetic fake camera (no hands); software resilience only" }));
} catch (error) {
  console.error(JSON.stringify({ results, errors: browser?.errors?.slice(-10) }));
  throw error;
} finally { await browser?.close(); server.kill(); await new Promise(done => relay.close(done)); }
