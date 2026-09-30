// Browser regression for settings, transcript workspaces and real IndexedDB.
// Camera permission and recognition messages are controlled fixtures, not an accuracy test.
// node tests/workspace-browser-smoke.mjs /path/to/chrome
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
const chrome = spawn(chromePath, ["--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--no-first-run",
  "--no-default-browser-check", "--disable-background-networking", `--user-data-dir=${profile}`,
  `--remote-debugging-port=${cdpPort}`, "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
  ...(fixture ? [`--use-file-for-fake-video-capture=${fixture}`] : []), "about:blank"],
  { stdio: ["ignore", "ignore", "pipe"] });
let chromeStderr = "";
chrome.stderr?.setEncoding("utf8");
chrome.stderr?.on("data", chunk => { chromeStderr += chunk; });
let socket;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, message, limit = 10000) {
  const start = Date.now();
  while (Date.now() - start < limit) { try { if (await check()) return; } catch {} await pause(200); }
  throw new Error(message);
}
async function waitForChrome(limit = 30000) {
  const start = Date.now();
  while (Date.now() - start < limit) {
    if (chrome.exitCode !== null) {
      throw new Error(`Chrome exited before CDP became ready (code ${chrome.exitCode}).\n${chromeStderr.slice(-4000)}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${cdpPort}/json/list`);
      if (response.ok) {
        const tabs = await response.json();
        if (tabs.length) return tabs;
      }
    } catch {}
    await pause(250);
  }
  throw new Error(`Chrome did not expose CDP within ${limit}ms.\n${chromeStderr.slice(-4000)}`);
}
try {
  await until(async () => (await fetch(`${origin}/`)).ok, "Static server failed");
  const tabs = await waitForChrome();
  const page = tabs.find(tab => tab.type === "page");
  assert(page?.webSocketDebuggerUrl, "Chrome CDP did not expose a page target");
  socket = new WebSocket(page.webSocketDebuggerUrl);
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
  await send("Runtime.enable"); await send("Network.enable"); await send("Page.enable");
  await send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `
    if (!sessionStorage.getItem('workspace-test-seeded')) {
      localStorage.setItem('signrelay.settings.v1', JSON.stringify({ autoSpeak: true, volume: 0.35, rate: 1.25, showOverlay: false }));
      sessionStorage.setItem('workspace-test-seeded', 'yes');
    }
    window.testWorkers = [];
    window.Worker = class {
      constructor() { window.testWorkers.push(this); }
      postMessage(message) { this.session = message.session; if (message.language) this.language = message.language; }
      terminate() { this.terminated = true; }
    };
    window.confirmSign = (text, gloss) => {
      const worker = window.testWorkers.findLast(worker => !worker.terminated);
      worker.onmessage({ data: { type: 'confirmed', session: worker.session, text, gloss, confidence: .9, timestamp: Date.now() } });
    };
    window.cameraStopped = 0;
    navigator.mediaDevices.getUserMedia = () => new Promise(resolve => { window.resolveCamera = () => resolve({ getTracks: () => [{ stop: () => window.cameraStopped++ }] }); });
    window.spoken = [];
    window.speechCancelled = 0;
    speechSynthesis.speak = value => window.spoken.push(value.text);
    speechSynthesis.cancel = () => { window.speechCancelled++; };
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => { window.copiedText = value; } } });
    const createURL = URL.createObjectURL.bind(URL);
    URL.createObjectURL = blob => { window.downloadText = blob.text(); return createURL(blob); };
  ` });
  await send("Page.navigate", { url: origin });
  await until(() => evaluate("document.querySelectorAll('.figma-language-row [role=radio]').length === 7"), "Automatic language row missing");
  await click("Got it");
  await until(async () => {
    await click("Start translating");
    return evaluate("!!document.querySelector('.workspace-page')");
  }, "Workspace failed to hydrate");
  assert.deepEqual(await evaluate("JSON.parse(localStorage.getItem('signrelay.settings.v1'))"), { autoSpeak: true, volume: .35, rate: 1.25, showOverlay: false }, "Mount must not overwrite saved settings");
  assert.equal(await evaluate("document.querySelector('.speech-controls input').checked"), true);
  assert.equal(await evaluate("document.querySelector('.camera-options input').checked"), false);
  assert.equal(await evaluate("document.querySelectorAll('.voice-ranges input')[0].value"), "0.35");
  assert.equal(await evaluate("document.querySelectorAll('.voice-ranges input')[1].value"), "1.25");
  await until(() => evaluate("!!window.resolveCamera"), "Permission request did not start");
  await click("Cancel camera");
  await evaluate("window.resolveCamera()");
  await until(() => evaluate("window.cameraStopped === 1"), "Late camera grant was not released after cancellation");
  assert.equal(await evaluate("document.querySelector('video').srcObject"), null);
  console.log("Saved settings and pending camera cancellation passed.");

  const entryText = () => evaluate("Array.from(document.querySelectorAll('.transcript-entry p')).map(p => p.textContent)");
  const choose = async language => {
    await evaluate(`(() => { const select = document.querySelector('select[aria-label="Change sign language"]'); select.value = ${JSON.stringify(language)}; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await until(() => evaluate(`document.querySelector('select').value === ${JSON.stringify(language)}`), "Language switch failed");
    await until(() => evaluate(`window.testWorkers.findLast(worker => !worker.terminated)?.language === ${JSON.stringify(language)}`), "Recognition worker did not switch language");
  };
  await until(() => evaluate("window.testWorkers.some(worker => !worker.terminated)"), "Recognition session did not initialize");
  await evaluate("window.confirmSign('Hello', 'HELLO')");
  await until(async () => (await entryText()).includes("Hello"), "Confirmation did not appear");
  assert.deepEqual(await evaluate("window.spoken"), ["Hello"]);
  await click("Copy");
  await until(() => evaluate("window.copiedText === 'Hello'"), "Copy did not contain transcript");
  await click("Download");
  assert.match(await evaluate("window.downloadText"), /American Sign Language[\s\S]*Hello/);
  await choose("lse");
  assert.deepEqual(await entryText(), [], "ASL transcript leaked into Spanish workspace");
  await evaluate("window.confirmSign('Hola', 'HOLA')");
  await until(async () => (await entryText()).includes("Hola"), "Spanish entry missing");
  await choose("asl");
  assert.deepEqual(await entryText(), ["Hello"], "ASL draft was lost on switch");
  await evaluate("window.originalSetItem = Storage.prototype.setItem; Storage.prototype.setItem = () => { throw new DOMException('Quota', 'QuotaExceededError'); }");
  await click("Save & clear");
  await until(() => evaluate("document.body.innerText.includes('Your transcript has been kept here')"), "Save failure was hidden");
  assert.deepEqual(await entryText(), ["Hello"], "Storage failure deleted transcript");
  await evaluate("Storage.prototype.setItem = window.originalSetItem");
  await click("Save & clear");
  await until(async () => (await entryText()).length === 0, "Saved transcript did not clear");
  assert.equal(await evaluate("JSON.parse(localStorage.getItem('signrelay.history.v1'))[0].language"), "asl");
  await choose("lse");
  assert.deepEqual(await entryText(), ["Hola"]);
  await click("Change language");
  await until(() => evaluate("!!document.querySelector('.figma-language-row')"), "Home navigation failed");
  await click("Start translating");
  await until(() => evaluate("!!document.querySelector('.workspace-page')"), "Workspace return failed");
  assert.deepEqual(await entryText(), ["Hola"], "Back navigation lost draft");
  await click("Cancel camera");
  await evaluate("document.querySelector('.speech-controls input').click()");
  await until(() => evaluate("JSON.parse(localStorage.getItem('signrelay.settings.v1')).autoSpeak === false"), "User settings change was not saved");
  console.log("Language isolation, draft navigation, copying, download and failed-save recovery passed.");

  // Exercise the actual storage implementation against Chrome IndexedDB.
  const bundled = await build({ stdin: { contents: 'export * from "./lib/calibration-storage";', resolveDir: process.cwd() }, bundle: true, write: false, platform: "browser", format: "iife", globalName: "storageUnderTest" });
  await evaluate(bundled.outputFiles[0].text);
  const storageResult = await evaluate(`(async () => {
    const api = storageUnderTest;
    const example = (id, createdAt, language = 'asl') => ({ id, createdAt, language, gloss: 'HELLO', text: 'Hello', frames: Array.from({ length: 24 }, () => Array(240).fill(0)) });
    await api.clearCalibrationTemplates();
    await Promise.all(Array.from({ length: 7 }, (_, index) => api.saveCalibrationTemplate(example('e' + index, index))));
    const newest = (await api.loadCalibrationTemplates()).map(item => item.id);
    await api.saveCalibrationTemplate(example('e6', 8));
    const updated = (await api.loadCalibrationTemplates()).map(item => item.id);
    await api.saveCalibrationTemplate(example('bsl', 9, 'bsl'));
    await api.deleteCalibrationGloss('HELLO', 'asl');
    const remaining = (await api.loadCalibrationTemplates()).map(item => item.language);
    // A successful request followed by transaction abort must not report success.
    const clear = IDBObjectStore.prototype.clear;
    IDBObjectStore.prototype.clear = function() {
      const request = clear.call(this);
      request.addEventListener('success', () => this.transaction.abort());
      return request;
    };
    let rejected = false;
    try { await api.clearCalibrationTemplates(); } catch { rejected = true; }
    finally { IDBObjectStore.prototype.clear = clear; }
    const afterAbort = (await api.loadCalibrationTemplates()).map(item => item.id);
    // Clear must run after a previously requested write, even while open is pending.
    await Promise.all([api.saveCalibrationTemplate(example('pending', 10)), api.clearCalibrationTemplates()]);
    const afterClear = await api.loadCalibrationTemplates();
    // No leaked open connection may block deletion/upgrade.
    const deleted = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Database deletion timed out')), 2000);
      const request = indexedDB.deleteDatabase('signrelay-personal-vocabulary');
      request.onsuccess = () => { clearTimeout(timer); resolve(true); };
      request.onblocked = () => { clearTimeout(timer); reject(new Error('Database connections leaked')); };
      request.onerror = () => { clearTimeout(timer); reject(request.error); };
    });
    return { newest, updated, remaining, rejected, afterAbort, afterClear, deleted };
  })()`);
  assert.deepEqual(storageResult, { newest: ["e6", "e5", "e4"], updated: ["e6", "e5", "e4"], remaining: ["bsl"], rejected: true, afterAbort: ["bsl"], afterClear: [], deleted: true });
  console.log("Real IndexedDB concurrent limits, language isolation, commit/abort, clear ordering and connection cleanup passed.");

  await mkdir("outputs", { recursive: true });
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await evaluate("document.querySelector('.transcript-panel').scrollIntoView({ block: 'start', behavior: 'instant' })");
  assert(await evaluate("document.documentElement.scrollWidth <= 390"), "Mobile overflow");
  await writeFile("outputs/workspace-mobile.png", Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64"));
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 960, deviceScaleFactor: 1, mobile: false });
  await writeFile("outputs/workspace-desktop.png", Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64"));
  await click("Clear local data");
  await until(() => evaluate("document.body.innerText.includes('Local data cleared. Camera stopped.')"), "Clear data failed");
  assert.deepEqual(await entryText(), []);
  assert.equal(await evaluate("localStorage.getItem('signrelay.history.v1')"), null);
  assert.equal(await evaluate("localStorage.getItem('signrelay.settings.v1')"), null);
  await choose("asl");
  assert.deepEqual(await entryText(), []);
  assert.equal(requests.filter(request => request.method === "POST").length, 0, "No upload expected");
  assert.equal(errors.length, 0, JSON.stringify(errors));
  console.log("Mobile layout, clear-all privacy flow and no-upload checks passed. No uncaught page errors.");
} finally {
  socket?.close(); chrome.kill(); server.kill();
  await pause(300);
  await rm(profile, { recursive: true, force: true });
}
