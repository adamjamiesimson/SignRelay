// F1 safeguard in the real workspace (production export, real camera pipeline
// with Chrome's synthetic camera). The recognition worker is replaced by a
// controlled stand-in that answers frames and emits exactly the messages under
// test, so every outcome is deterministic. Software behaviour only.
//   npm run build && node tests/model-suggestion-browser-smoke.mjs <chrome>
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { startChrome } from "../scripts/diagnostics/chrome-session.mjs";
import { RETURNING_VISITOR } from "./helpers/returning-visitor.mjs";

const executable = process.argv[2];
if (!executable) throw new Error("usage: node tests/model-suggestion-browser-smoke.mjs <chrome>");
const port = 19700 + Math.floor(Math.random() * 300), origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["scripts/serve-export.mjs", "--port", String(port)], { stdio: "ignore" });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, reason, attempts = 300) {
  for (let i = 0; i < attempts; i++) { if (await check()) return; await pause(50); }
  throw new Error(reason);
}
const checks = [];
let browser;
try {
  await until(async () => { try { return (await fetch(origin)).ok; } catch { return false; } }, "No static server");
  browser = await startChrome(executable);
  await browser.send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
    window.__qa = { spoken: [], workers: [], urls: [] };
    const NativeWorker = window.Worker;
    window.Worker = class {
      constructor(url, options) {
        window.__qa.urls.push(String(url));
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
    window.__qaSend = (message, session) => { const w = window.__qaLive(); w.onmessage?.({ data: { session: session ?? w.session, timestamp: Date.now(), ...message } }); };
    window.__qaSuggest = (id, gloss, session) => window.__qaSend({ type: 'suggested', id, language: 'asl', text: gloss[0] + gloss.slice(1).toLowerCase(), gloss, confidence: 0.9, source: 'model' }, session);
    window.__qaConfirm = (gloss, source) => window.__qaSend({ type: 'confirmed', text: gloss[0] + gloss.slice(1).toLowerCase(), gloss, confidence: 0.9, source });
    window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { speak: u => window.__qa.spoken.push(u.text), cancel: () => {} } });
  })();` });
  await browser.send("Page.addScriptToEvaluateOnNewDocument", { source: RETURNING_VISITOR });
  await browser.send("Page.navigate", { url: origin });
  const evaluate = browser.evaluate;
  const click = text => evaluate(`(() => { const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}); if(!b) throw new Error('Missing button '+${JSON.stringify(text)}); b.click(); })()`);
  const choose = name => evaluate(`[...document.querySelectorAll('[role=radio]')].find(b=>b.textContent.includes(${JSON.stringify(name)}))?.click()`);
  const checked = name => evaluate(`document.querySelector('[role=radio][aria-checked=true]')?.textContent.includes(${JSON.stringify(name)})`);
  const entries = () => evaluate("[...document.querySelectorAll('.transcript-entry p')].map(p => p.textContent)");
  const card = () => evaluate("document.querySelector('.model-suggestion')?.dataset.suggestionKey ?? null");
  const action = kind => `document.querySelector('[data-suggestion-action=${kind}]')`;
  const announcements = () => evaluate("[...document.querySelectorAll('.sr-only[role=status]')].map(n => n.textContent).join(' | ')");
  const active = () => evaluate("document.querySelector('.status-badge')?.textContent === 'Active'");

  await until(() => evaluate("!!document.querySelector('.language-row [role=radio]')"), "Welcome screen missing");
  await until(async () => { await choose("British"); return checked("British"); }, "Welcome screen did not hydrate");
  await choose("American"); await until(() => checked("American"), "ASL selection failed");
  await click("Start signing");
  await until(active, "Camera did not become active", 600);
  await until(() => evaluate("!!window.__qaLive()"), "Recognition worker missing");
  // Auto speak ON: the strictest setting for accidental speech.
  await evaluate("(()=>{const box=document.querySelector('.speech-controls input[type=checkbox]');if(!box.checked)box.click();})()");
  await until(() => evaluate("document.querySelector('.speech-controls input[type=checkbox]').checked"), "Auto speak did not enable");

  // 1. A suggestion is shown, labelled, not inserted, not spoken, announced as not added.
  const focusBefore = await evaluate("document.activeElement?.outerHTML.slice(0, 60)");
  await evaluate("window.__qaSuggest('s1', 'BOOK')");
  await until(async () => (await card()) !== null, "Suggestion not shown");
  assert.match(await evaluate("document.querySelector('.model-suggestion').textContent"), /Experimental suggestion · not added.*Book.*research model/s);
  assert.deepEqual(await entries(), [], "A suggestion entered the transcript");
  assert.deepEqual(await evaluate("window.__qa.spoken"), [], "A suggestion was spoken");
  assert.match(await announcements(), /Experimental suggestion: Book\. Not added to the transcript\./);
  assert.equal(await evaluate("document.activeElement?.outerHTML.slice(0, 60)"), focusBefore, "Focus moved to the suggestion");
  assert.equal(await evaluate(`${action("accept")}.getAttribute('aria-disabled')`), "true", "Add is armed immediately");
  checks.push("suggestion shown and labelled; transcript unchanged; nothing spoken (auto speak on); announced as not added; focus not moved");

  // 2. An immediate activation (before arming) does nothing.
  await evaluate(`${action("accept")}.click()`);
  assert.deepEqual(await entries(), [], "An immediate tap accepted the suggestion");
  checks.push("activation within 600 ms of appearing is ignored");

  // 3. Keyboard: Tab-reachable, Enter adds once; double activation adds once; focus returns to the transcript.
  await pause(700);
  assert.equal(await evaluate(`${action("accept")}.getAttribute('aria-disabled')`), "false");
  await evaluate(`${action("accept")}.scrollIntoView({ block: "center" })`);
  await evaluate(`${action("accept")}.focus()`);
  const box = await evaluate(`(() => { const r = ${action("accept")}.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
  await browser.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
  await browser.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await until(async () => (await entries()).length === 1, "Accepted word missing (keyboard)");
  assert.equal(await evaluate("document.activeElement?.id"), "transcript-title", "Focus did not return to the transcript");
  // A second, real pointer click where the Add button was: nothing more is added.
  await browser.send("Input.dispatchMouseEvent", { type: "mousePressed", x: box[0], y: box[1], button: "left", clickCount: 1 });
  await browser.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: box[0], y: box[1], button: "left", clickCount: 1 });
  await pause(200);
  assert.deepEqual(await entries(), ["Book · added from suggestion"], "Double activation added twice or the provenance is missing");
  assert.equal(await card(), null, "Suggestion still shown after acceptance");
  assert.deepEqual(await evaluate("window.__qa.spoken"), ["Book"], "The accepted word must be spoken exactly once with auto speak on");
  assert.match(await announcements(), /Added: Book/);
  checks.push("keyboard Enter adds once; an extra click adds nothing; provenance shown; spoken once only after acceptance; focus returns to the transcript");

  // 4. Dismiss removes it without adding or speaking.
  await evaluate("window.__qaSuggest('s2', 'CHAIR')"); await until(async () => (await card())?.endsWith(":s2"), "Second suggestion missing");
  await evaluate(`${action("dismiss")}.click()`);
  await until(async () => (await card()) === null, "Dismiss did not remove the suggestion");
  assert.deepEqual(await entries(), ["Book · added from suggestion"]); assert.deepEqual(await evaluate("window.__qa.spoken"), ["Book"]);
  checks.push("dismiss removes the suggestion; nothing added or spoken");

  // 5. Superseded: a newer suggestion replaces the older; a stale click on the old key cannot add it.
  await evaluate("window.__qaSuggest('s3', 'TABLE')"); await until(async () => (await card())?.endsWith(":s3"), "s3 missing");
  await pause(700);
  const staleButton = await evaluate(`(${action("accept")}.dataset.qaStale = '1', true)`); void staleButton;
  await evaluate("window.__qaSuggest('s4', 'WINDOW')"); await until(async () => (await card())?.endsWith(":s4"), "s4 did not replace s3");
  await evaluate(`${action("accept")}.click()`); // the replacement is still arming
  await pause(100);
  assert.deepEqual(await entries(), ["Book · added from suggestion"], "A superseded or unarmed suggestion was added");
  // A starter-rule confirmation supersedes the pending suggestion and is unchanged.
  await evaluate(`${action("accept")}.focus()`);
  await evaluate("window.__qaConfirm('HELLO', 'starter')");
  await until(async () => (await entries()).includes("Hello"), "Starter confirmation missing");
  assert.equal(await card(), null, "A confirmed word did not withdraw the suggestion");
  assert.equal(await evaluate("document.activeElement?.id"), "transcript-title", "Focus was lost when a confirmed word withdrew the suggestion");
  assert.deepEqual(await evaluate("window.__qa.spoken"), ["Book", "Hello"], "Starter words must still be spoken automatically");
  checks.push("newer suggestion replaces older; stale and unarmed clicks add nothing; starter confirmation is unchanged (inserted, announced, auto-spoken) and withdraws the suggestion");

  // 6. Personal-sign confirmations are unchanged.
  await evaluate("window.__qaConfirm('MY SIGN', 'personal')");
  await until(async () => (await entries()).includes("My sign"), "Personal confirmation missing");
  checks.push("personal-sign confirmation unchanged");

  // 7. A model-only ASL *confirmation* (e.g. an old cached worker) is demoted, never inserted.
  await evaluate("window.__qaConfirm('GOOD', 'model')");
  await until(async () => (await card()) !== null, "Model confirmation was not demoted to a suggestion");
  assert.equal((await entries()).includes("Good"), false, "A model-only confirmation entered the transcript");
  assert.deepEqual(await evaluate("window.__qa.spoken"), ["Book", "Hello", "My sign"], "A demoted model word was spoken");
  checks.push("a model-sourced 'confirmed' message is demoted to a suggestion: not inserted, not spoken");

  // 8. A suggestion from a replaced session is dropped.
  const live = await evaluate("window.__qaLive().session");
  await evaluate(`window.__qaSuggest('old', 'STALE', ${live - 1})`); await pause(150);
  assert.equal((await evaluate("document.querySelector('.model-suggestion strong')?.textContent")), "Good", "A stale-session suggestion was shown");
  checks.push("suggestion from a replaced session ignored");

  // 9. Camera interruption withdraws it.
  await click("Pause camera");
  await until(async () => (await card()) === null, "Pausing the camera did not withdraw the suggestion");
  await click("Start camera"); await until(active, "Camera did not restart", 600);
  await until(() => evaluate("!!window.__qaLive()"), "Worker missing after restart");
  checks.push("camera pause withdraws the suggestion");

  // 10. Worker failure withdraws it.
  await evaluate("window.__qaSuggest('s5', 'LAMP')"); await until(async () => (await card()) !== null, "s5 missing");
  await evaluate("window.__qaLive().onerror?.(new Event('error'))");
  await until(async () => (await card()) === null, "A worker failure did not withdraw the suggestion");
  checks.push("worker failure withdraws the suggestion");

  // 11. Expiry after 12 s.
  await until(() => evaluate("!!window.__qaLive() && !window.__qaLive().closed"), "Worker did not recover", 400);
  await pause(1500);
  await evaluate("window.__qaSuggest('s6', 'DOOR')"); await until(async () => (await card()) !== null, "s6 missing");
  await pause(12600);
  assert.equal(await card(), null, "An unanswered suggestion did not expire");
  checks.push("unanswered suggestion withdrawn after 12 s");

  // 12. Mobile: the suggestion controls are at least 44 px and do not overflow.
  await evaluate("window.__qaSuggest('s7', 'WATER')"); await until(async () => (await card()) !== null, "s7 missing");
  await browser.send("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 1, mobile: true });
  await pause(300);
  const sizes = await evaluate("[...document.querySelectorAll('[data-suggestion-action]')].map(b => { const r = b.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })");
  for (const [w, h] of sizes) assert.ok(w >= 44 && h >= 44, `suggestion control ${w}x${h} under 44 px`);
  assert.ok(await evaluate("document.documentElement.scrollWidth <= 375"), "Suggestion overflows a phone viewport");
  checks.push(`phone (375 px): suggestion controls ${sizes.map(s => s.join("x")).join(", ")} px; no horizontal overflow`);
  await browser.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

  // 13. Language switch withdraws it; saved history keeps provenance and stays readable.
  await evaluate(`(() => { const s = document.querySelector('select[aria-label="Change sign language"]'); s.value = 'bsl'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await until(async () => (await card()) === null, "Switching language did not withdraw the suggestion");
  const saved = await evaluate("JSON.parse(localStorage.getItem('signrelay.history.v1') || '[]')[0]");
  assert.equal(saved.language, "asl");
  assert.deepEqual(saved.entries.map(e => [e.text, e.source, e.acceptedBy ?? null]), [["Book", "model", "user"], ["Hello", "starter", null], ["My sign", "personal", null]]);
  checks.push("language switch withdraws the suggestion; saved history keeps source and acceptedBy=user (older readers ignore the extra field)");

  assert.ok((await evaluate("window.__qa.urls")).some(u => u.includes("recognition.worker.js?v=f1-suggestions-1")), "Worker URL version not updated");
  console.log("MODEL-SUGGESTION-SMOKE", JSON.stringify({ passed: checks.length, checks }));
} finally { await browser?.close(); server.kill(); }
