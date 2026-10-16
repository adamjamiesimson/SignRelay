// Actual checkpoint + pinned Tasks in Chrome with a synthetic camera. Execution only.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { startChrome } from "../scripts/diagnostics/chrome-session.mjs";
const chromePath = process.argv[2];
assert(chromePath, "Supply a Chrome executable path");
const port = 18000 + Math.floor(Math.random() * 1000), origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["scripts/serve-export.mjs", "--port", String(port)], { stdio: "ignore" });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, message, limit = 10000) {
  const start = Date.now();
  while (Date.now() - start < limit) { try { if (await check()) return; } catch {} await pause(200); }
  throw new Error(message);
}
let browser;
try {
  await build({ entryPoints: ["tests/lse-browser-probe.ts"], bundle: true, format: "esm", platform: "browser", target: "es2020", outfile: "out/workers/lse-smoke-probe.js" });
  await until(async () => (await fetch(`${origin}/`)).ok, "Static server failed");
  browser = await startChrome(chromePath, { forwardAssets: true });
  const { send, evaluate } = browser;
  const errors = [], requests = [];
  browser.onEvent(message => {
    if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails);
    if (message.method === "Network.requestWillBeSent") requests.push(message.params.request);
    if (message.method === "Target.attachedToTarget") {
      const sessionId = message.params.sessionId;
      void send("Network.enable", {}, sessionId)
        .then(() => send("Runtime.runIfWaitingForDebugger", {}, sessionId))
        .catch(error => errors.push(String(error)));
    }
  });
  const click = text => evaluate(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes(${JSON.stringify(text)}))?.click()`);
  await send("Runtime.enable"); await send("Network.enable");
  await send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
  await send("Page.navigate", { url: origin });
  await until(() => evaluate("document.querySelectorAll('.figma-language-row [role=radio]').length === 7"), "Automatic language row missing");
  await until(async () => {
    await click("Spanish Sign Language");
    return await evaluate("Array.from(document.querySelectorAll('.figma-language-row [role=radio]')).some(b => b.textContent.includes('Spanish Sign Language') && b.getAttribute('aria-checked') === 'true')");
  }, "Spanish language choice did not hydrate");
  await click("Start translating");
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
  await until(() => evaluate("!!document.querySelector('.figma-language-row')"), "Back navigation failed");
  assert.equal(errors.length, 0, JSON.stringify(errors));
  console.log("Three real Spanish model inferences, camera release, navigation and no-upload checks passed. No uncaught page errors.");

} finally {
  await browser?.close(); server.kill();
  await rm("out/workers/lse-smoke-probe.js", { force: true });
}
