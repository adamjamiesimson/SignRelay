import assert from "node:assert/strict";
import { readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { serve } from "./serve.mjs";
import { startChrome } from "../scripts/diagnostics/chrome-session.mjs";
import { fingerprint } from "../scripts/evaluation-manifest.mjs";

const [browser, handFile, modelFile, intakeFile, assetId, output, cameraFile] = process.argv.slice(2);
if (!output) throw new Error("Supply Chrome, hand asset, model, guarded intake, recording hash, output and optional Y4M");
const soak = Number(process.env.SIGNRELAY_V2_SOAK_SECONDS ?? 0);
if (!Number.isInteger(soak) || soak < 0 || soak > 180 || (soak && cameraFile)) throw new Error("Invalid idle-camera soak setting");
const intake = JSON.parse(await readFile(intakeFile));
const fixture = intake.find(row => row.sha256 === assetId);
assert(fixture, "Supply a recording from the guarded intake");
assert.equal(fingerprint(await readFile(fixture.file)), assetId);
if (cameraFile && !(await stat(cameraFile)).isFile()) throw new Error("Fake camera fixture is missing");
const staticPreview = process.env.SIGNRELAY_V2_STATIC_PREVIEW === "1";
const remotePreview = process.env.SIGNRELAY_V2_PREVIEW_ORIGIN;
if (remotePreview && !remotePreview.startsWith("https://")) throw new Error("A remote preview must use HTTPS");
const server = remotePreview ? null : staticPreview ? await (await import("./serve-preview.mjs")).servePreview()
  : await serve({ handFile, modelFile, port: 0 });
let chrome;
try {
  const started = performance.now();
  chrome = await startChrome(browser, {
    proxy: "http://127.0.0.1:9",
    extraArgs: cameraFile ? ["--use-file-for-fake-video-capture=" + resolve(cameraFile)] : [],
  });
  const origin = remotePreview ?? "http://127.0.0.1:" + server.address().port;
  const external = [];
  chrome.onEvent(event => {
    if (event.method !== "Network.requestWillBeSent") return;
    const { url } = event.params.request;
    if (!url.startsWith(origin + "/") && !url.startsWith("blob:" + origin + "/") && !url.startsWith("data:")) external.push(url);
  });
  await chrome.send("Runtime.enable");
  await chrome.send("DOM.enable");
  await chrome.send("Page.navigate", { url: origin });
  async function until(expression, deadline = 25000) {
    const expires = performance.now() + deadline;
    while (performance.now() < expires) {
      const value = await chrome.evaluate(expression);
      if (value) return value;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error("Browser timeout: " + await chrome.evaluate("document.getElementById('status')?.textContent"));
  }
  const snapshot = () => chrome.evaluate(`Object.fromEntries(['status','version','match','reason','events','fps','latency','hands','drops','diagnostics']
    .map(id => [id, document.getElementById(id).textContent]))`);
  await until("Boolean(document.getElementById('file'))");
  if (staticPreview || remotePreview) {
    assert(await chrome.evaluate("isSecureContext && !document.getElementById('policy-control').hidden"));
    await chrome.evaluate("document.getElementById('policy').value = 'fresh'");
  }
  await until("document.readyState === 'complete'");
  const { root } = await chrome.send("DOM.getDocument");
  const { nodeId } = await chrome.send("DOM.querySelector", { nodeId: root.nodeId, selector: "#file" });
  await chrome.send("DOM.setFileInputFiles", { nodeId, files: [fixture.file] });
  await chrome.evaluate("document.getElementById('file').dispatchEvent(new Event('change', {bubbles: true}))");
  await until("/File complete|failed|could not/i.test(document.getElementById('status').textContent)", 90000);
  const file = await snapshot();
  assert.match(file.status, /^File complete/);
  assert(Number(file.fps) > 0);
  const evidence = {
    fixture: assetId, test: cameraFile ? "file-backed camera" : "synthetic camera",
    file, fileTransitions: await chrome.evaluate("window.signRelayCameraDiagnostics?.()"),
    trackerProfile: process.env.SIGNRELAY_V2_VISION_PROFILE ?? "auto",
    captureProfile: process.env.SIGNRELAY_V2_CAPTURE ?? "track",
    browserVersion: (await chrome.send("Browser.getVersion")).product,
  };
  const save = () => writeFile(output, JSON.stringify({ ...evidence, errors: chrome.errors }, null, 2));
  await save();
  if (process.env.SIGNRELAY_V2_EXPECT) {
    assert.equal(file.match, process.env.SIGNRELAY_V2_EXPECT, "Reference clip prediction changed");
  }
  const traceCamera = cameraFile && process.env.SIGNRELAY_V2_TRACE_CAMERA === "1";
  if (traceCamera) await chrome.evaluate(`(() => {
    const video = document.getElementById("video");
    const canvas = new OffscreenCanvas(12, 12);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const source = [], processed = [];
    const post = Worker.prototype.postMessage;
    let pending;
    Worker.prototype.postMessage = function(message, transfer) {
      if (message.type === "start") this.addEventListener("message", ({data}) => {
        if (data.type === "frame" && processed.length < 1200) processed.push({t: pending, hand: data.hand, ms: data.ms});
      });
      if (message.type === "frame") pending = message.timestamp;
      return post.call(this, message, transfer);
    };
    let callback;
    const collect = (_now, metadata) => {
      context.drawImage(video, 0, 0, 12, 12);
      const { data } = context.getImageData(0, 0, 12, 12);
      let minimum = 255, maximum = 0;
      for (let i = 0; i < data.length; i += 4) {
        const level = (data[i] + data[i + 1] + data[i + 2]) / 3;
        minimum = Math.min(minimum, level);
        maximum = Math.max(maximum, level);
      }
      source.push({t: metadata.mediaTime * 1000, active: maximum - minimum > 12});
      if (source.length < 1200) callback = video.requestVideoFrameCallback(collect);
    };
    callback = video.requestVideoFrameCallback(collect);
    window.finishCameraTrace = () => {
      video.cancelVideoFrameCallback(callback);
      Worker.prototype.postMessage = post;
      const activity = source.filter(frame => frame.active);
      const start = activity[0]?.t, end = activity.at(-1)?.t;
      const during = processed.filter(frame => frame.t >= start && frame.t <= end);
      const timings = during.map(frame => frame.ms.hand).sort((a, b) => a - b);
      return { sampledSourceFrames: source.length, nonUniformFrames: activity.length, activeStartMs: start, activeEndMs: end,
        processedInActiveRange: during.length, handsInActiveRange: during.filter(frame => frame.hand).length,
        medianHandMsInActiveRange: timings[Math.floor(timings.length / 2)] };
    };
  })()`);
  const cameraStarted = performance.now();
  const scoreTrial = process.env.SIGNRELAY_V2_SCORE_TRIAL === "1";
  if (scoreTrial) {
    assert(process.env.SIGNRELAY_V2_CAMERA_EXPECT, "Supply the expected camera word to score a trial");
    await chrome.evaluate(`(() => {
      document.querySelector('.trial-panel').open = true;
      document.getElementById('trial-prompt').value = ${JSON.stringify(process.env.SIGNRELAY_V2_CAMERA_EXPECT)};
      document.getElementById('trial-start').click();
    })()`);
  } else await chrome.evaluate("document.getElementById('camera').click()");
  await until("/Camera running|failed|could not/i.test(document.getElementById('status').textContent)", 45000);
  const cameraStartup = performance.now() - cameraStarted;
  assert.match((await snapshot()).status, /^Camera running/);
  await until(cameraFile ? "document.getElementById('video').currentTime >= 18"
    : "Number(document.getElementById('hands').textContent.split('/')[1]) >= 50", 40000);
  if (soak) await until(`document.getElementById('video').currentTime >= ${soak}`, (soak + 30) * 1000);
  const camera = await snapshot();
  evidence.cameraTransitions = await chrome.evaluate("window.signRelayCameraDiagnostics?.()");
  if (staticPreview || remotePreview) {
    assert.equal(evidence.cameraTransitions.runtime.policy, "fresh");
    assert(await chrome.evaluate("document.getElementById('policy').disabled"));
  }
  if (traceCamera) evidence.cameraTrace = await chrome.evaluate("window.finishCameraTrace()");
  if (soak) {
    assert.equal(camera.events, "", "Synthetic idle camera produced a suggestion");
    evidence.syntheticIdleSeconds = soak;
  }
  Object.assign(evidence, { camera, cameraStartupMs: cameraStartup });
  await save();
  if (scoreTrial) {
    const logged = await chrome.evaluate(`(async () => {
      document.getElementById('trial-finish').click();
      document.getElementById('trial-prompt').value = 'movement';
      document.getElementById('trial-start').click();
      document.getElementById('stop').click();
      const makeUrl = URL.createObjectURL;
      const click = HTMLAnchorElement.prototype.click;
      let download, contents;
      URL.createObjectURL = blob => { contents = blob.text(); return makeUrl.call(URL, blob); };
      HTMLAnchorElement.prototype.click = function () { download = this.download; };
      try { document.getElementById('trial-download').click(); return { download, log: JSON.parse(await contents) }; }
      finally { URL.createObjectURL = makeUrl; HTMLAnchorElement.prototype.click = click; }
    })()`);
    assert.equal(logged.download, "signrelay-webcam-trials.json");
    assert.equal(logged.log.schema, "signrelay-webcam-trials-1");
    assert.equal(logged.log.trials.length, 2);
    const [trial, cancelled] = logged.log.trials;
    assert.equal(trial.outcome, "correct");
    assert.deepEqual(trial.emitted, [process.env.SIGNRELAY_V2_CAMERA_EXPECT]);
    assert.equal(cancelled.prompt, "movement");
    assert.equal(cancelled.outcome, "failed");
    assert.deepEqual(cancelled.emitted, []);
    assert.deepEqual(Object.keys(trial).sort(), ["analyzedFps", "conditions", "duplicateWords", "emitted", "expected", "frames",
      "number", "outcome", "overflow", "prompt", "startupMs", "usableHands"].sort());
    evidence.scoredTrialExport = logged;
  } else await chrome.evaluate("document.getElementById('stop').click()");
  assert.equal(await chrome.evaluate("document.getElementById('video').srcObject === null"), true);
  if (staticPreview || remotePreview) {
    assert(await chrome.evaluate("!document.getElementById('policy').disabled"));
    await chrome.evaluate("document.getElementById('policy').value = 'baseline'");
    await chrome.evaluate(`window.originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Test denial', 'NotAllowedError'); };`);
    await chrome.evaluate("document.getElementById('camera').click()");
    await until("/^Camera permission denied/.test(document.getElementById('status').textContent)", 45000);
    assert(await chrome.evaluate("document.getElementById('video').srcObject === null"));
    await chrome.evaluate("navigator.mediaDevices.getUserMedia = window.originalGetUserMedia; delete window.originalGetUserMedia;");
    evidence.permissionDenial = true;
  }
  await chrome.evaluate("document.getElementById('camera').click()");
  await until("/^Camera running/.test(document.getElementById('status').textContent)", 45000);
  if (staticPreview || remotePreview) {
    assert.equal(await chrome.evaluate("signRelayCameraDiagnostics().runtime.policy"), "baseline");
    evidence.policySwitch = true;
  }
  await chrome.evaluate("document.getElementById('video').srcObject.getVideoTracks()[0].dispatchEvent(new Event('ended'))");
  await until("/^Camera disconnected/.test(document.getElementById('status').textContent)");
  assert.equal(await chrome.evaluate("document.getElementById('video').srcObject === null"), true);
  await chrome.evaluate("window.savedWorker = Worker; window.Worker = class extends savedWorker { constructor() { super('/missing-worker.js'); } }");
  await chrome.evaluate("document.getElementById('camera').click()");
  await until("/Recognition worker (stopped|could not start)/.test(document.getElementById('status').textContent)");
  await chrome.evaluate("window.Worker = window.savedWorker; delete window.savedWorker");
  await chrome.evaluate("document.getElementById('camera').click()");
  await until("/^Camera running/.test(document.getElementById('status').textContent)", 45000);
  await chrome.evaluate("document.getElementById('stop').click()");
  assert.deepEqual(external, [], "The local demo made a non-local request");
  Object.assign(evidence, { noExternalRequests: true, cameraRestart: true, disconnectRecovery: true,
    workerLoadRecovery: true, softwareTestMs: performance.now() - started });
  await save();
  console.log(JSON.stringify({ file, camera, cameraStartupMs: cameraStartup }));
  if (process.env.SIGNRELAY_V2_CAMERA_EXPECT) {
    assert.equal(camera.events, "Recent suggestions · " + process.env.SIGNRELAY_V2_CAMERA_EXPECT,
      "Camera replay must emit the expected sign exactly once");
  }
} finally {
  await chrome?.close().catch(error => console.warn("Chrome profile cleanup:", error.message));
  server?.close();
}
