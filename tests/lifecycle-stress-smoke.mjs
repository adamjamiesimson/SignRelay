// Camera and worker lifecycle stress on the built export with Chromium's
// synthetic fake camera (no hands). Checks that repeated start/pause cycles,
// rapid toggles, hidden-tab pauses, an externally ended camera track and
// leaving/re-entering the workspace always release camera tracks, keep a
// bounded number of recognition workers and keep analysing frames. Software
// lifecycle only; says nothing about recognition accuracy or real devices.
//   node tests/lifecycle-stress-smoke.mjs /path/to/chrome
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { startChrome } from "../scripts/diagnostics/chrome-session.mjs";

const executable = process.argv[2];
if (!executable) throw new Error("Usage: node tests/lifecycle-stress-smoke.mjs <chrome> (after building the export)");
const port = 18100 + Math.floor(Math.random() * 300), origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["scripts/serve-export.mjs", "--host", "127.0.0.1", "--port", String(port)], { stdio: "ignore" });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, reason, attempts = 300) {
  for (let i = 0; i < attempts; i++) { if (await check()) return; await pause(100); }
  throw new Error(reason);
}
let browser;
try {
  await until(async () => { try { return (await fetch(origin)).ok; } catch { return false; } }, "No static server");
  browser = await startChrome(executable);
  const evaluate = browser.evaluate;
  await browser.send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
    window.__qa = { tracks: [], workers: [], frames: 0 };
    const get = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async options => { const stream = await get(options); window.__qa.tracks.push(...stream.getTracks()); return stream; };
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(url, options) { super(url, options); this.__url = String(url); this.__alive = true; window.__qa.workers.push(this); }
      terminate() { this.__alive = false; return super.terminate(); }
      postMessage(message, transfer) { if (message?.type === 'frame') window.__qa.frames++; return super.postMessage(message, transfer); }
    };
  })();` });
  const button = text => `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)})`;
  const click = text => evaluate(`(() => { const b=${button(text)}; if(!b||b.disabled) throw new Error('Missing button '+${JSON.stringify(text)}); b.click(); })()`);
  const has = text => evaluate(`!!${button(text)}`);
  const active = () => evaluate("document.querySelector('.status-badge')?.textContent === 'Active'");
  const released = () => evaluate("window.__qa.tracks.length > 0 && window.__qa.tracks.every(t => t.readyState === 'ended')");
  const liveTracks = () => evaluate("window.__qa.tracks.filter(t => t.readyState === 'live').length");
  const aliveRecognition = () => evaluate("window.__qa.workers.filter(w => w.__alive && w.__url.includes('recognition.worker')).length");
  const frames = () => evaluate("window.__qa.frames");
  const heapMb = async () => { await browser.send("HeapProfiler.collectGarbage").catch(() => {}); return evaluate("performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null"); };
  const report = { checks: [] };

  await browser.send("Page.navigate", { url: `${origin}/?perf` });
  await until(() => evaluate("Object.keys(document.querySelector('[role=radio]') ?? {}).some(k=>k.startsWith('__reactFiber'))"), "Welcome screen did not hydrate");
  await click("Start translating");
  await until(active, "Camera did not start");
  const heapStart = await heapMb();

  // 1. Repeated start/pause cycles.
  const cycleMs = [];
  for (let cycle = 0; cycle < 12; cycle++) {
    await click("Pause camera");
    await until(async () => await released() && await has("Start camera"), `Cycle ${cycle + 1}: camera not released`);
    const started = Date.now();
    await click("Start camera");
    await until(active, `Cycle ${cycle + 1}: camera did not restart`);
    cycleMs.push(Date.now() - started);
    assert.equal(await liveTracks(), 1, `Cycle ${cycle + 1}: more than one live camera track`);
  }
  assert.equal(await aliveRecognition(), 1, "Start/pause must not leak recognition workers");
  report.checks.push({ name: "12 start/pause cycles", restart_ms_p50: cycleMs.sort((a, b) => a - b)[6], restart_ms_max: cycleMs.at(-1) });

  // 2. Rapid toggles while the camera is starting (late permission must release).
  for (let i = 0; i < 6; i++) {
    await click("Pause camera");
    await until(() => has("Start camera"), "Pause did not settle");
    await click("Start camera");
    await pause(30 + i * 15);
    if (await has("Cancel")) await click("Cancel"); else if (await has("Pause camera")) await click("Pause camera");
    await until(() => has("Start camera"), `Rapid toggle ${i + 1}: did not settle`);
    await pause(400);
    assert.equal(await liveTracks(), 0, `Rapid toggle ${i + 1}: a camera track stayed live after cancelling`);
    await click("Start camera");
    await until(active, `Rapid toggle ${i + 1}: camera did not restart`);
  }
  report.checks.push({ name: "6 rapid start/cancel toggles", live_tracks_after_cancel: 0 });

  // 3. Hidden tab stops analysis; visible resumes.
  await evaluate("(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));})()");
  await pause(500);
  const hiddenFrames = await frames();
  await pause(1500);
  assert.equal(await frames(), hiddenFrames, "Frames were analysed while hidden");
  await evaluate("(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));})()");
  await until(async () => await frames() > hiddenFrames + 3, "Analysis did not resume after the tab became visible");
  report.checks.push({ name: "hidden tab pauses and resumes analysis" });

  // 4. Camera track ended outside the app (unplugged device / revoked permission).
  await evaluate("window.__qa.tracks.filter(t => t.readyState === 'live').forEach(t => t.stop())");
  // track.stop() from script does not fire "ended", so the app's 8 s
  // no-progress watchdog must catch it; a device-ended track fires "ended".
  await until(() => evaluate("/The camera stopped sending video|The camera was disconnected/.test(document.body.textContent)"), "Ended camera track was not reported", 150);
  assert.equal(await liveTracks(), 0);
  await until(() => has("Start camera") || has("Retry camera"), "No way to restart the camera");
  await click((await has("Start camera")) ? "Start camera" : "Retry camera");
  await until(active, "Camera did not recover after an external stop");
  report.checks.push({ name: "externally ended camera track is reported and recoverable" });

  // 5. Leave the workspace and come back.
  for (let i = 0; i < 3; i++) {
    await click("Change language");
    await until(() => evaluate("!!document.querySelector('.figma-language-row [role=radio]')"), "Did not return to the welcome screen");
    await until(released, "Leaving the workspace did not release the camera");
    await until(async () => await aliveRecognition() === 0, "Leaving the workspace did not terminate the recognition worker");
    await click("Start translating");
    await until(active, "Workspace did not restart");
  }
  assert.equal(await aliveRecognition(), 1);
  report.checks.push({ name: "3 leave/re-enter workspace cycles" });

  await click("Pause camera");
  await until(released, "Final pause did not release the camera");
  const heapEnd = await heapMb();
  report.heap_mb = { start: heapStart, end: heapEnd };
  if (heapStart !== null && heapEnd !== null) assert.ok(heapEnd - heapStart < 40, `JS heap grew by ${heapEnd - heapStart} MB across the stress run`);
  report.workers_created = await evaluate("window.__qa.workers.length");
  report.errors = browser.errors.filter(error => typeof error === "string");
  assert.deepEqual(report.errors, [], "Uncaught page exceptions");
  console.log(JSON.stringify({ passed: true, ...report, environment: "headless Chromium, synthetic fake camera (no hands); software lifecycle only" }));
} finally { await browser?.close(); server.kill(); }
