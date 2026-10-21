// CDN-blocked demo smoke: the ASL workspace must start real MediaPipe vision
// from the self-hosted /vision/ copy with jsDelivr and googleapis unreachable,
// and release the camera when paused. Timings come from headless Chromium on
// the machine running the test with a synthetic camera; they are not phone or
// laptop measurements and say nothing about recognition accuracy.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { startChrome } from "../scripts/diagnostics/chrome-session.mjs";

const executable = process.argv[2];
if (!executable) throw new Error("Supply Chrome executable after building the public export");
const port = 18800 + Math.floor(Math.random() * 400), origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["scripts/serve-export.mjs", "--port", String(port)], { stdio: "ignore" });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, reason, attempts = 600) {
  for (let i = 0; i < attempts; i++) { if (await check()) return; await pause(100); }
  throw new Error(reason);
}
let browser, detach;
try {
  await until(async () => { try { return (await fetch(origin)).ok; } catch { return false; } }, "No static server");
  browser = await startChrome(executable);
  const cdnRequests = [], visionRequests = [];
  detach = browser.onEvent(message => {
    if (message.method !== "Network.requestWillBeSent") return;
    const url = message.params.request.url;
    if (/cdn\.jsdelivr\.net|storage\.googleapis\.com/.test(url)) cdnRequests.push(url);
    if (url.includes("/vision/")) visionRequests.push(new URL(url).pathname);
  });
  await browser.send("Network.enable");
  await browser.send("Network.setBlockedURLs", { urls: ["*cdn.jsdelivr.net*", "*storage.googleapis.com*"] });
  await browser.send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
    window.__qaTracks = []; window.__qaFrames = 0;
    const get = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async options => { const stream = await get(options); window.__qaTracks.push(...stream.getTracks()); return stream; };
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      postMessage(message, transfer) { if (message?.type === 'frame') window.__qaFrames++; return super.postMessage(message, transfer); }
    };
  })();` });
  await browser.send("Page.navigate", { url: origin });
  const evaluate = browser.evaluate;
  const click = text => evaluate(`(() => { const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}); if(!b||b.disabled) throw new Error('Missing button '+${JSON.stringify(text)}); b.click(); })()`);
  await until(() => evaluate("!!document.querySelector('.figma-language-row [role=radio]')"), "Welcome screen missing");
  await until(async () => {
    await evaluate("[...document.querySelectorAll('[role=radio]')].find(b=>b.textContent.includes('American'))?.click()");
    return evaluate("document.querySelector('[role=radio][aria-checked=true]')?.textContent.includes('American')");
  }, "Welcome screen did not hydrate", 100);
  const active = () => evaluate("document.querySelector('.status-badge')?.textContent === 'Active'");
  const cycles = [];
  for (let cycle = 0; cycle < 3; cycle++) {
    const started = Date.now();
    if (cycle === 0) await click("Start translating"); else await click("Start camera");
    await until(active, `Vision did not start without CDNs (cycle ${cycle + 1}): ` + "status");
    const coldStartMs = Date.now() - started;
    const framesBefore = await evaluate("window.__qaFrames");
    await pause(4000);
    const framesPerSecond = (await evaluate("window.__qaFrames") - framesBefore) / 4;
    const status = await evaluate("document.querySelector('.recognition-state')?.textContent.trim()");
    const sequence = await evaluate("document.querySelector('.candidate-bar strong')?.textContent");
    await click("Pause camera");
    await until(() => evaluate("window.__qaTracks.length > 0 && window.__qaTracks.every(t => t.readyState === 'ended')"), "Camera tracks were not released");
    await until(() => evaluate("document.querySelector('.recognition-state')?.textContent.includes('camera off')"), "Camera-off state not shown");
    await browser.send("HeapProfiler.collectGarbage").catch(() => {});
    const heapMb = await evaluate("performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null");
    cycles.push({ cold_start_ms: coldStartMs, frames_forwarded_per_s: framesPerSecond, status_while_no_hands: status, sequence_text: sequence, js_heap_mb_after_pause: heapMb });
  }
  assert.equal(cdnRequests.length, 0, `CDN requests were attempted: ${cdnRequests.join(", ")}`);
  assert.ok(visionRequests.some(path => path.endsWith("gesture_recognizer.task")), "Self-hosted models were not used");
  assert.ok(visionRequests.some(path => path.startsWith("/vision/wasm/")), "Self-hosted WASM was not used");
  for (const cycle of cycles) {
    assert.ok(cycle.frames_forwarded_per_s > 0, "No frames reached recognition");
    assert.match(cycle.sequence_text, /Waiting for hands/);
    assert.equal(cycle.status_while_no_hands, "waiting for hands", "Camera on without hands must say so, not 'uncertain' or 'listening'");
  }
  console.log(JSON.stringify({ passed: true, cdn_blocked: true, cdn_requests: cdnRequests.length,
    self_hosted_paths: [...new Set(visionRequests)].sort(), cycles,
    environment: "headless Chromium, synthetic fake camera (no hands), this machine's CPU; not a physical device measurement" }));
} finally { detach?.(); await browser?.close(); server.kill(); }
