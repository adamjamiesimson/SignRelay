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
  browser = await startChrome(executable, { dismissOnboarding: true });
  const evaluate = browser.evaluate;
  await browser.send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
    window.__qa = { tracks: [], workers: [], frames: 0, resets: 0, trackingMs: [], delegate: null, confirmations: 0 };
    const get = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async options => { const stream = await get(options); window.__qa.tracks.push(...stream.getTracks()); return stream; };
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(url, options) {
        super(url, options); this.__url = String(url); this.__alive = true; window.__qa.workers.push(this);
        this.addEventListener('message', ({ data }) => {
          if (this.__url.includes('asl-v3-tracker.worker')) {
            if (data.type === 'ready') { window.__qa.delegate = data.delegate; this.__ready = true; }
            if (data.type === 'frame') {
              window.__qa.trackingMs.push(data.trackingMs);
              if (window.__qa.trackingMs.length > 240) window.__qa.trackingMs.shift();
            }
          }
          if (this.__url.includes('recognition.worker') && data.type === 'confirmed') window.__qa.confirmations++;
        });
      }
      terminate() { this.__alive = false; return super.terminate(); }
      postMessage(message, transfer) {
        // The V3.1 client may add one parallel pose helper (same script, role "pose").
        if (this.__url.includes('asl-v3-tracker.worker') && message?.type === 'init') this.__role = message.role ?? 'tracker';
        if (this.__url.includes('recognition.worker')) {
          if (message?.type === 'frame') window.__qa.frames++;
          if (message?.type === 'reset') window.__qa.resets++;
        }
        return super.postMessage(message, transfer);
      }
    };
  })();` });
  const button = text => `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)})`;
  const click = text => evaluate(`(() => { const b=${button(text)}; if(!b||b.disabled) throw new Error('Missing button '+${JSON.stringify(text)}); b.click(); })()`);
  const has = text => evaluate(`!!${button(text)}`);
  const active = () => evaluate("document.querySelector('.status-badge')?.textContent === 'Active'");
  const released = () => evaluate("window.__qa.tracks.length > 0 && window.__qa.tracks.every(t => t.readyState === 'ended')");
  const liveTracks = () => evaluate("window.__qa.tracks.filter(t => t.readyState === 'live').length");
  const aliveRecognition = () => evaluate("window.__qa.workers.filter(w => w.__alive && w.__url.includes('recognition.worker')).length");
  const aliveTracking = () => evaluate("window.__qa.workers.filter(w => w.__alive && w.__url.includes('asl-v3-tracker.worker') && w.__role !== 'pose').length");
  const alivePose = () => evaluate("window.__qa.workers.filter(w => w.__alive && w.__url.includes('asl-v3-tracker.worker') && w.__role === 'pose').length");
  const frames = () => evaluate("window.__qa.frames");
  const heapMb = async () => { await browser.send("HeapProfiler.collectGarbage").catch(() => {}); return evaluate("performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null"); };
  const report = { checks: [] };

  await browser.send("Page.navigate", { url: `${origin}/?perf` });
  await until(() => evaluate("Object.keys(document.querySelector('[role=radio]') ?? {}).some(k=>k.startsWith('__reactFiber'))"), "Welcome screen did not hydrate");
  const cameraRequestedAt = Date.now();
  await click("Start signing");
  await until(active, "Camera did not start");
  report.camera_startup_ms = Date.now() - cameraRequestedAt;
  assert.equal(await aliveTracking(), 1, "ASL must start exactly one V3.1 tracking worker");
  assert.ok(await alivePose() <= 1, "ASL must start at most one parallel pose helper");
  report.pose_helper = await alivePose() === 1;
  assert.equal(await liveTracks(), 1, "ASL must own exactly one camera stream");
  report.delegate = await evaluate("window.__qa.delegate");
  assert.match(report.delegate, /^(CPU|GPU)$/);
  const heapStart = await heapMb();
  const sampleBegan = Date.now(), initialFrames = await frames();
  await until(async () => await frames() >= initialFrames + 30, "Camera did not forward 30 frames");
  report.forwarded_fps = Number(((await frames() - initialFrames) * 1000 / (Date.now() - sampleBegan)).toFixed(1));
  const trackingMs = await evaluate("window.__qa.trackingMs.slice().sort((a,b)=>a-b)");
  report.tracking_ms = { p50: Math.round(trackingMs[Math.floor(trackingMs.length * 0.5)]),
    p95: Math.round(trackingMs[Math.floor(trackingMs.length * 0.95)]) };

  // 1. Repeated start/pause cycles.
  const cycleMs = [];
  for (let cycle = 0; cycle < 12; cycle++) {
    await click("Pause camera");
    await until(async () => await released() && await has("Start camera") && await aliveTracking() === 0,
      `Cycle ${cycle + 1}: camera or tracker not released`);
    const started = Date.now();
    await click("Start camera");
    await until(active, `Cycle ${cycle + 1}: camera did not restart`);
    cycleMs.push(Date.now() - started);
    assert.equal(await liveTracks(), 1, `Cycle ${cycle + 1}: more than one live camera track`);
    assert.equal(await aliveTracking(), 1, `Cycle ${cycle + 1}: more than one live ASL tracker`);
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
    assert.equal(await aliveTracking(), 0, `Rapid toggle ${i + 1}: an ASL tracker stayed live after cancelling`);
    await click("Start camera");
    await until(active, `Rapid toggle ${i + 1}: camera did not restart`);
  }
  report.checks.push({ name: "6 rapid start/cancel toggles", live_tracks_after_cancel: 0 });

  // 3. Hidden tab stops analysis and interrupts any personal capture.
  await click("Record example");
  await until(() => evaluate("document.querySelector('.calibration-message.countdown') !== null"), "Calibration did not begin");
  await evaluate("(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));})()");
  await pause(500);
  assert.match(await evaluate("document.querySelector('.calibration-message.idle')?.textContent"), /Recording interrupted/);
  const hiddenFrames = await frames();
  await pause(1500);
  assert.equal(await frames(), hiddenFrames, "Frames were analysed while hidden");
  await evaluate("(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));})()");
  await until(async () => await frames() > hiddenFrames + 3, "Analysis did not resume after the tab became visible");
  report.checks.push({ name: "hidden tab cancels calibration, then resumes analysis on return" });

  // A single processing error must invalidate previously queued output even
  // when the next frame succeeds and the camera stays active.
  const resets = await evaluate("window.__qa.resets");
  await evaluate(`(() => {
    const canvas = document.querySelector('video').parentElement.querySelector('canvas');
    const context = canvas.getContext('2d');
    const original = context.clearRect;
    context.clearRect = function () { this.clearRect = original; throw new Error('Injected frame processing error'); };
  })()`);
  await until(async () => await evaluate("window.__qa.resets") === resets + 1, "Failed frame did not invalidate recognition");
  const framesAfterFault = await frames();
  await until(async () => await frames() > framesAfterFault + 3, "Processing did not resume after an isolated failure");
  assert.equal(await active(), true);
  report.checks.push({ name: "one processing failure resets recognition and recovers" });

  await evaluate(`(() => {
    const tracker = window.__qa.workers.find(w => w.__alive && w.__url.includes('asl-v3-tracker.worker') && w.__role !== 'pose');
    tracker.onerror(new ErrorEvent('error', { message: 'Injected tracker crash' }));
  })()`);
  await until(async () => await released() && await aliveTracking() === 0 && await alivePose() === 0 && await has("Retry camera"),
    "Tracker crash did not release the camera or expose retry");
  await click("Retry camera");
  await until(active, "Camera did not restart after tracker crash");
  report.checks.push({ name: "tracker crash releases the camera, then retries" });

  // A pose-helper crash is not a camera fault: tracking continues with in-worker pose.
  await until(async () => await alivePose() === 1 || !report.pose_helper, "Pose helper did not restart with the camera");
  if (report.pose_helper) {
    await until(() => evaluate("window.__qa.workers.some(w => w.__alive && w.__role === 'pose' && w.__ready)"), "Pose helper did not become ready");
    await evaluate(`(() => {
      const pose = window.__qa.workers.find(w => w.__alive && w.__role === 'pose');
      pose.onerror(new ErrorEvent('error', { message: 'Injected pose helper crash' }));
    })()`);
    await until(async () => await alivePose() === 0, "Crashed pose helper was not released");
    const framesAfterPoseCrash = await frames();
    await until(async () => await frames() > framesAfterPoseCrash + 10, "Tracking did not continue after a pose helper crash");
    assert.equal(await active(), true, "A pose helper crash must not stop the camera");
    assert.equal(await aliveTracking(), 1);
    report.checks.push({ name: "pose helper crash falls back to in-worker pose without a camera fault" });
  }

  // 4. Camera track ended outside the app (unplugged device / revoked permission).
  await evaluate("window.__qa.tracks.filter(t => t.readyState === 'live').forEach(t => t.stop())");
  // track.stop() from script does not fire "ended" (a device-ended track does),
  // and branded Chrome keeps advancing the video clock, so the frame loop must
  // notice the ended track itself rather than wait for the 8 s watchdog.
  await until(() => evaluate("/The camera was disconnected/.test(document.body.textContent)"), "Ended camera track was not reported", 50);
  assert.equal(await liveTracks(), 0);
  await until(() => has("Start camera") || has("Retry camera"), "No way to restart the camera");
  await click((await has("Start camera")) ? "Start camera" : "Retry camera");
  await until(active, "Camera did not recover after an external stop");
  report.checks.push({ name: "externally ended camera track is reported and recoverable" });

  // 5. Leave the workspace and come back.
  for (let i = 0; i < 3; i++) {
    await click("Change language");
    await until(() => evaluate("!!document.querySelector('.language-row [role=radio]')"), "Did not return to the welcome screen");
    await until(released, "Leaving the workspace did not release the camera");
    await until(async () => await aliveRecognition() === 0, "Leaving the workspace did not terminate the recognition worker");
    assert.equal(await aliveTracking(), 0, "Leaving the workspace did not terminate the tracking worker");
    assert.equal(await alivePose(), 0, "Leaving the workspace did not terminate the pose helper");
    await click("Start signing");
    await until(active, "Workspace did not restart");
  }
  assert.equal(await aliveRecognition(), 1);
  report.checks.push({ name: "3 leave/re-enter workspace cycles" });

  await evaluate("window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))");
  await until(async () => await released() && await aliveTracking() === 0 && await alivePose() === 0 && await has("Start camera"),
    "Pagehide did not release camera or tracking workers");
  await click("Start camera");
  await until(active, "Camera did not restart after pagehide");
  report.checks.push({ name: "pagehide releases camera with restart available" });

  const durationArg = process.argv.find(value => value.startsWith("--sustained-ms="));
  if (process.argv.includes("--sustained") || durationArg) {
    const duration = durationArg ? Number(durationArg.split("=")[1]) : 60000;
    assert.ok(Number.isInteger(duration) && duration >= 1000 && duration <= 3600000, "Invalid sustained duration");
    const before = await frames(), started = Date.now();
    // Sample in short intervals so a stopped pipeline fails promptly.
    while (Date.now() - started < duration) {
      await pause(Math.min(5000, duration - (Date.now() - started)));
      assert.equal(await active(), true, "Sustained camera stopped");
    }
    const forwarded = (await frames()) - before;
    assert.ok(forwarded > duration / 1000, "Sustained camera session stopped delivering observations");
    assert.equal(await active(), true);
    assert.equal(await liveTracks(), 1);
    assert.equal(await aliveTracking(), 1);
    assert.equal(await aliveRecognition(), 1);
    report.checks.push({ name: "continuous fake-camera session", duration_ms: Date.now() - started, forwarded_frames: forwarded });
  }
  await click("Pause camera");
  await until(released, "Final pause did not release the camera");
  assert.equal(await aliveTracking(), 0);
  assert.equal(await evaluate("window.__qa.confirmations"), 0, "Fake no-sign input produced a confirmation");
  const heapEnd = await heapMb();
  report.heap_mb = { start: heapStart, end: heapEnd };
  if (heapStart !== null && heapEnd !== null) assert.ok(heapEnd - heapStart < 40, `JS heap grew by ${heapEnd - heapStart} MB across the stress run`);
  report.workers_created = await evaluate("window.__qa.workers.length");
  report.errors = browser.errors.filter(error => typeof error === "string");
  assert.deepEqual(report.errors, [], "Uncaught page exceptions");
  console.log(JSON.stringify({ passed: true, ...report, environment: "headless Chromium, synthetic fake camera (no hands); software lifecycle only" }));
} finally { await browser?.close(); server.kill(); }
