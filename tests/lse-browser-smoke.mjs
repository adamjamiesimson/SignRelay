// Full browser smoke test; requires a built export, Chrome and an optional Y4M
// camera fixture. No real camera is used. This verifies execution, not accuracy.
// node tests/lse-browser-smoke.mjs /path/to/chrome
import assert from "node:assert/strict";
import { build } from "esbuild";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [chromePath, fixture] = process.argv.slice(2);
assert(chromePath, "Supply a Chrome executable path");
const profile = await mkdtemp(join(tmpdir(), "signrelay-browser-"));
const port = 18000 + Math.floor(Math.random() * 1000), cdpPort = port + 1000;
const origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["scripts/serve-export.mjs", "--port", String(port)], { stdio: "ignore" });
const chrome = spawn(chromePath, ["--headless", "--no-sandbox", "--disable-dev-shm-usage", `--user-data-dir=${profile}`,
  `--remote-debugging-port=${cdpPort}`, "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
  ...(fixture ? [`--use-file-for-fake-video-capture=${fixture}`] : []), "about:blank"], { stdio: "ignore" });
let socket;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, message, limit = 10000) {
  const start = Date.now();
  while (Date.now() - start < limit) { try { if (await check()) return; } catch {} await pause(200); }
  throw new Error(message);
}
try {
  await build({ entryPoints: ["tests/lse-browser-probe.ts"], bundle: true, format: "esm", platform: "browser", target: "es2020", outfile: "out/workers/lse-smoke-probe.js" });
  await until(async () => (await fetch(`${origin}/`)).ok, "Static server failed");
  let tabs;
  await until(async () => { tabs = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json(); return tabs.length; }, "Chrome failed");
  socket = new WebSocket(tabs.find(tab => tab.type === "page").webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let id = 0;
  const pending = new Map(), errors = [], requests = [];
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) { const task = pending.get(message.id); pending.delete(message.id); if (message.error) task?.reject(message.error); else task?.resolve(message.result); }
    if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails);
    if (message.method === "Network.requestWillBeSent") requests.push(message.params.request);
    if (message.method === "Target.attachedToTarget") {
      const sessionId = message.params.sessionId;
      void send("Network.enable", {}, sessionId)
        .then(() => send("Runtime.runIfWaitingForDebugger", {}, sessionId))
        .catch(error => errors.push(error));
    }
  };
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => { const key = ++id; pending.set(key, { resolve, reject }); socket.send(JSON.stringify({ id: key, method, params, sessionId })); });
  const evaluate = async expression => {
    const value = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (value.exceptionDetails) throw new Error(JSON.stringify(value.exceptionDetails));
    return value.result?.value;
  };
  const click = text => evaluate(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes(${JSON.stringify(text)}))?.click()`);
  await send("Runtime.enable"); await send("Network.enable");
  await send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
  await send("Page.navigate", { url: origin });
  await until(() => evaluate("!!document.querySelector('.language-search input')"), "Language browser missing");
  await click("Browse all 40");
  await until(() => evaluate("document.querySelectorAll('[role=radio]').length === 40"), "Language browser did not hydrate");
  await evaluate("document.querySelector('.language-search input').focus()");
  await send("Input.insertText", { text: "Spanish" });
  await until(() => evaluate("document.querySelectorAll('[role=radio]').length === 1"), "Language search failed");
  assert.equal(await evaluate("document.querySelector('[role=radio]').tabIndex"), 0, "Filtered choice must remain keyboard focusable");
  await evaluate("document.querySelector('[role=radio]').click()");
  await click("Continue to camera");
  await until(() => evaluate("document.querySelector('.workspace-title p')?.textContent === 'Spanish Sign Language'"), "Spanish workspace missing");
  assert.match(await evaluate("document.querySelector('.honesty-banner')?.textContent"), /300 isolated signs/);
  assert.equal(requests.filter(request => request.url.endsWith("model.onnx")).length, 0, "Weights must load only after signing");
  await mkdir("outputs", { recursive: true });
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  assert(await evaluate("document.documentElement.scrollWidth <= 390"), "Mobile overflow");
  await writeFile("outputs/lse-mobile.png", Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64"));
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 960, deviceScaleFactor: 1, mobile: false });
  await click("Start camera");
  await until(() => evaluate("!!document.querySelector('video')?.srcObject && !!document.querySelector('.camera-guidance')"), "Camera/trackers failed", 180000);
  await pause(2000);
  assert.equal(await evaluate("document.querySelectorAll('.transcript-entry').length"), 0, "Fake empty camera must not create words");
  console.log("Spanish selection, mobile layout and fake camera tracking passed.");
  await click("Pause");
  await until(() => evaluate("document.querySelector('video')?.srcObject === null"), "Pause failed to release camera");
  // Exercise the production runtime on controlled landmarks. This checks actual
  // browser inference and tensor cleanup, never recognition accuracy.
  const result = await evaluate(`new Promise((resolve, reject) => {
    const worker = new Worker('/workers/lse-smoke-probe.js', { type: 'module' });
    const timer = setTimeout(() => { worker.terminate(); reject(new Error('Inference timeout')); }, 90000);
    worker.onerror = event => { clearTimeout(timer); worker.terminate(); reject(new Error(event.message)); };
    let completed = 0;
    const frames = Array.from({length:80}, (_, i) => ({
      timestamp: i * 40, face: [],
      pose: Array.from({length:33}, (_, j) => ({x:0.3 + j*0.01, y:0.4, z:j*0.001})),
      hands: [{handedness:'Right', gesture:'None', gestureScore:0,
        landmarks:Array.from({length:21}, (_, j) => ({x:0.4 + Math.min(i, 50)*0.002 + j*0.002, y:0.5-j*0.002,z:j*0.001}))}]
    }));
    worker.onmessage = ({data}) => {
      if (data.type === 'error') { clearTimeout(timer); worker.terminate(); reject(new Error(data.message)); return; }
      if (++completed < 3) { worker.postMessage(frames); return; }
      clearTimeout(timer); worker.terminate(); resolve({type:data.type, completed});
    };
    worker.postMessage(frames);
  })`);
  assert.deepEqual(result, {type:"complete", completed:3});
  assert(requests.some(request => request.url === `${origin}/models/lse300-swl/model.onnx`), "Expected the local Spanish checkpoint");
  assert.equal(requests.filter(request => request.method === "POST").length, 0, "No camera upload expected");
  await writeFile("outputs/lse-desktop.png", Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64"));
  await click("Change language");
  await until(() => evaluate("!!document.querySelector('.language-search input')"), "Back navigation failed");
  assert.equal(errors.length, 0, JSON.stringify(errors));
  console.log("Three real Spanish model inferences, camera release, navigation and no-upload checks passed. No uncaught page errors.");

} finally {
  socket?.close(); chrome.kill(); server.kill();
  await rm("out/workers/lse-smoke-probe.js", { force: true });
  await pause(300);
  await rm(profile, { recursive: true, force: true });
}
