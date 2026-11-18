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
const server = await serve({ handFile, modelFile, port: 0 });
let chrome;
try {
  const started = performance.now();
  chrome = await startChrome(browser, {
    proxy: "http://127.0.0.1:9",
    extraArgs: cameraFile ? ["--use-file-for-fake-video-capture=" + resolve(cameraFile)] : [],
  });
  const origin = "http://127.0.0.1:" + server.address().port;
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
    file, trackerProfile: process.env.SIGNRELAY_V2_VISION_PROFILE ?? "cpu",
    browserVersion: (await chrome.send("Browser.getVersion")).product,
  };
  const save = () => writeFile(output, JSON.stringify({ ...evidence, errors: chrome.errors }, null, 2));
  await save();
  if (process.env.SIGNRELAY_V2_EXPECT) {
    assert.equal(file.match, process.env.SIGNRELAY_V2_EXPECT, "Reference clip prediction changed");
  }
  const cameraStarted = performance.now();
  await chrome.evaluate("document.getElementById('camera').click()");
  await until("/Camera running|failed|could not/i.test(document.getElementById('status').textContent)");
  const cameraStartup = performance.now() - cameraStarted;
  assert.match((await snapshot()).status, /^Camera running/);
  await until(cameraFile ? "document.getElementById('video').currentTime >= 18"
    : "Number(document.getElementById('hands').textContent.split('/')[1]) >= 50", 40000);
  if (soak) await until(`document.getElementById('video').currentTime >= ${soak}`, (soak + 30) * 1000);
  const camera = await snapshot();
  if (soak) {
    assert.equal(camera.events, "", "Synthetic idle camera produced a suggestion");
    evidence.syntheticIdleSeconds = soak;
  }
  Object.assign(evidence, { camera, cameraStartupMs: cameraStartup });
  await save();
  await chrome.evaluate("document.getElementById('stop').click()");
  assert.equal(await chrome.evaluate("document.getElementById('video').srcObject === null"), true);
  await chrome.evaluate("document.getElementById('camera').click()");
  await until("/^Camera running/.test(document.getElementById('status').textContent)");
  await chrome.evaluate("document.getElementById('video').srcObject.getVideoTracks()[0].dispatchEvent(new Event('ended'))");
  await until("/^Camera disconnected/.test(document.getElementById('status').textContent)");
  assert.equal(await chrome.evaluate("document.getElementById('video').srcObject === null"), true);
  await chrome.evaluate("window.savedWorker = Worker; window.Worker = class extends savedWorker { constructor() { super('/missing-worker.js'); } }");
  await chrome.evaluate("document.getElementById('camera').click()");
  await until("/Recognition worker (stopped|could not start)/.test(document.getElementById('status').textContent)");
  await chrome.evaluate("window.Worker = window.savedWorker; delete window.savedWorker");
  await chrome.evaluate("document.getElementById('camera').click()");
  await until("/^Camera running/.test(document.getElementById('status').textContent)");
  await chrome.evaluate("document.getElementById('stop').click()");
  assert.deepEqual(external, [], "The local demo made a non-local request");
  Object.assign(evidence, { noExternalRequests: true, cameraRestart: true, disconnectRecovery: true,
    workerLoadRecovery: true, softwareTestMs: performance.now() - started });
  await save();
  console.log(JSON.stringify({ file, camera, cameraStartupMs: cameraStartup }));
} finally {
  await chrome?.close().catch(error => console.warn("Chrome profile cleanup:", error.message));
  server.close();
}
