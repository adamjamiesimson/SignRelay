// Full browser smoke test; requires a built export, Chrome and an optional Y4M
// camera fixture. No real camera is used. This verifies execution, not accuracy.
// node tests/rsl-browser-smoke.mjs /path/to/chrome [/path/to/fixture.y4m]
import assert from "node:assert/strict";
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
  const status = () => evaluate("document.querySelector('[role=status]')?.textContent");
  await send("Runtime.enable"); await send("Network.enable");
  await send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
  await send("Page.navigate", { url: origin });
  await until(() => evaluate("!!document.querySelector('.language-search input')"), "Language browser missing");
  await click("Browse all 40");
  await until(() => evaluate("document.querySelectorAll('[role=radio]').length === 40"), "Language browser did not hydrate");
  await evaluate("document.querySelector('.language-search input').focus()");
  await send("Input.insertText", { text: "Russian" });
  await until(() => evaluate("document.querySelectorAll('[role=radio]').length === 1"), "Language search failed");
  assert.equal(await evaluate("document.querySelector('[role=radio]').tabIndex"), 0, "Filtered choice must remain keyboard focusable");
  await evaluate("document.querySelector('[role=radio]').click()");
  await click("Continue to camera");
  await until(() => evaluate("!!document.querySelector('#rsl-title')"), "RSL workspace missing");
  assert.equal(requests.filter(request => request.url.endsWith("model.onnx")).length, 0, "Weights should not load before start");
  await mkdir("outputs", { recursive: true });
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  assert(await evaluate("document.documentElement.scrollWidth <= 390"), "Mobile overflow");
  await writeFile("outputs/rsl-mobile.png", Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64"));
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 960, deviceScaleFactor: 1, mobile: false });
  console.log("Language selection, lazy loading and mobile layout passed.");
  await click("Start camera");
  await until(async () => /Ready\./.test(await status()), "Model/camera failed to become ready", 180000);
  console.log("Actual pretrained ONNX loaded in Chrome; fake camera ready.");
  await click("Recognize one sign");
  await until(async () => /Experimental suggestion|No confident match/.test(await status()), "Camera inference did not finish", 120000);
  console.log("Camera capture and worker inference completed:", await status());
  await writeFile("outputs/rsl-desktop.png", Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64"));
  assert(requests.some(request => request.url === `${origin}/models/rsl1000-slovo/model.onnx`), "Expected local pretrained weights request");
  assert.equal(requests.filter(request => request.method === "POST").length, 0, "No camera upload expected");
  await click("Recognize one sign");
  await click("Stop / cancel");
  await pause(3500);
  assert.equal(await evaluate("document.querySelector('video').srcObject"), null);
  assert.equal(await evaluate("document.querySelector('.rsl-result')"), null);
  assert.match(await status(), /Stopped/);
  await click("Back to languages");
  await until(() => evaluate("!!document.querySelector('.language-search input')"), "Back navigation failed");
  assert.equal(errors.length, 0, JSON.stringify(errors));
  console.log("Cancellation, camera release, navigation and no-upload checks passed. No uncaught page errors.");
} finally {
  socket?.close(); chrome.kill(); server.kill();
  await pause(300);
  await rm(profile, { recursive: true, force: true });
}
