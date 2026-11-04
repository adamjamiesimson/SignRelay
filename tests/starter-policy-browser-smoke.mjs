// Starter-rule output policy in the real browser, on a built export.
//   research:   an export built with NEXT_PUBLIC_SIGNRELAY_STARTER_OUTPUT=auto SIGNRELAY_RESEARCH_EXPORT=1.
//               On this device (127.0.0.1) starter words are automatic and a research banner is shown;
//               the SAME files opened from a public-looking host fall back to suggestions.
//   production: the default export. No banner and starter words are suggestions on every host.
//   node tests/starter-policy-browser-smoke.mjs <chrome> research|production
// The recognition worker is a controlled stand-in (as in model-suggestion-browser-smoke.mjs).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { startChrome } from "../scripts/diagnostics/chrome-session.mjs";
import { RETURNING_VISITOR } from "./helpers/returning-visitor.mjs";

const [executable, mode] = process.argv.slice(2);
if (!executable || !["research", "production"].includes(mode)) throw new Error("usage: node tests/starter-policy-browser-smoke.mjs <chrome> research|production");
const port = 19400 + Math.floor(Math.random() * 300);
const PUBLIC_HOST = "signrelay-public.test";
const server = spawn(process.execPath, ["scripts/serve-export.mjs", "--port", String(port)], { stdio: "ignore" });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, reason, attempts = 300) {
  for (let i = 0; i < attempts; i++) { if (await check()) return; await pause(50); }
  throw new Error(reason);
}
const STUB = `(() => {
  window.__qa = { workers: [] };
  const NativeWorker = window.Worker;
  window.Worker = class {
    constructor(url, options) {
      if (!String(url).includes('recognition.worker.js')) return new NativeWorker(url, options);
      this.onmessage = this.onerror = this.onmessageerror = null; this.closed = false; this.session = 0;
      window.__qa.workers.push(this);
    }
    postMessage(message) {
      if (typeof message.session === 'number') this.session = message.session;
      if (message.type === 'frame') this.onmessage?.({ data: { type: 'analysis', session: this.session, frameId: message.frameId, state: 'listening', candidate: null, confidence: 0, bufferSize: 0 } });
    }
    terminate() { this.closed = true; }
  };
  window.__qaLive = () => window.__qa.workers.filter(w => !w.closed).at(-1);
  window.__qaConfirm = (gloss, source) => { const w = window.__qaLive(); w.onmessage?.({ data: { type: 'confirmed', session: w.session, timestamp: performance.now(),
    text: gloss[0] + gloss.slice(1).toLowerCase(), gloss, confidence: 0.86, source } }); };
  window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { speak: () => {}, cancel: () => {} } });
})();`;

const checks = [];
let browser;
try {
  await until(async () => { try { return (await fetch(`http://127.0.0.1:${port}`)).ok; } catch { return false; } }, "No static server");
  // The public-looking host resolves to this machine; it is treated as a secure origin only so the
  // synthetic camera works, which is what a real HTTPS host would allow.
  browser = await startChrome(executable, { proxy: "", extraArgs: [`--host-resolver-rules=MAP ${PUBLIC_HOST} 127.0.0.1`,
    `--unsafely-treat-insecure-origin-as-secure=http://${PUBLIC_HOST}:${port}`] });
  await browser.send("Page.addScriptToEvaluateOnNewDocument", { source: STUB });
  await browser.send("Page.addScriptToEvaluateOnNewDocument", { source: RETURNING_VISITOR });
  const evaluate = browser.evaluate;
  const entries = () => evaluate("[...document.querySelectorAll('.transcript-entry p')].map(p => p.textContent)");
  const cards = () => evaluate("[...document.querySelectorAll('.model-suggestion')].map(c => c.dataset.suggestionSource + ':' + c.querySelector('strong').textContent)");
  const banner = () => evaluate("(() => { const b = document.querySelector('.research-build-banner'); return b ? { mode: b.dataset.researchBuild, text: b.textContent } : null; })()");

  async function openWorkspace(origin) {
    await browser.send("Page.navigate", { url: origin });
    await until(() => evaluate("!!document.querySelector('.language-row [role=radio]')"), `Welcome screen missing on ${origin}`);
    await until(async () => { await evaluate("[...document.querySelectorAll('[role=radio]')].find(b=>b.textContent.includes('British'))?.click()");
      return evaluate("document.querySelector('[role=radio][aria-checked=true]')?.textContent.includes('British')"); }, "Welcome screen did not hydrate");
    await evaluate("[...document.querySelectorAll('[role=radio]')].find(b=>b.textContent.includes('American'))?.click()");
    await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Start signing').click()");
    await until(() => evaluate("document.querySelector('.status-badge')?.textContent === 'Active'"), `Camera did not start on ${origin}`, 600);
    await until(() => evaluate("!!window.__qaLive()"), "Recognition worker missing");
  }

  // 1. This device.
  await openWorkspace(`http://127.0.0.1:${port}`);
  await evaluate("window.__qaConfirm('HELLO', 'starter')");
  if (mode === "research") {
    await until(async () => (await entries()).includes("Hello · sign rules"), "Research build on this device did not insert the starter word automatically");
    assert.deepEqual(await cards(), []);
    assert.deepEqual(await banner(), { mode: "auto", text: "Research build: sign-rule words are added automatically. Not for public use." });
    checks.push("research export on this device: starter word inserted automatically, labelled 'sign rules', research banner shown");
  } else {
    await until(async () => (await cards()).includes("starter:Hello"), "Production build did not offer the starter word as a suggestion");
    assert.deepEqual(await entries(), []);
    assert.equal(await banner(), null, "Production build shows a research banner");
    checks.push("production export on this device: starter word is a suggestion; no research banner");
  }
  await evaluate("window.__qaConfirm('MY SIGN', 'personal')");
  await until(async () => (await entries()).includes("My sign · your sign"), "Personal sign not inserted automatically");
  checks.push("personal signs inserted automatically (unchanged)");

  // 2. The same files from a public-looking host.
  await openWorkspace(`http://${PUBLIC_HOST}:${port}`);
  await evaluate("window.__qaConfirm('THANK YOU', 'starter')");
  await until(async () => (await cards()).includes("starter:Thank you"), "Starter word on a public host was not a suggestion");
  assert.equal((await entries()).some(e => e.startsWith("Thank you")), false, "A starter word was inserted automatically on a public host");
  if (mode === "research") {
    assert.deepEqual(await banner(), { mode: "suggest", text: "Research build opened from a public address: sign-rule words are suggestions only." });
    checks.push(`the same research export from a public host (${PUBLIC_HOST}): falls back to suggestions, banner says so`);
  } else {
    assert.equal(await banner(), null);
    checks.push(`production export from a public host (${PUBLIC_HOST}): starter word is a suggestion; no banner`);
  }
  console.log("STARTER-POLICY-SMOKE", JSON.stringify({ mode, passed: checks.length, checks }));
} finally { await browser?.close(); server.kill(); }
