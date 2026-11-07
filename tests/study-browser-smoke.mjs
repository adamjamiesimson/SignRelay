// The private /study route on a production-profile export built with
// SIGNRELAY_INCLUDE_PRIVATE_CAPTURE=1 (marked, never deployable). Real camera
// pipeline with Chrome's synthetic camera; the recognition worker is a
// controlled stand-in. Checks consent gating, event capture only inside a task
// window, scoring, the downloaded log (validated with the same library), axe,
// and that nothing is stored or sent.
//   node tests/study-browser-smoke.mjs <chrome> node_modules/axe-core/axe.min.js
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startChrome } from "../scripts/diagnostics/chrome-session.mjs";
import { loadStudy } from "../scripts/signer-study.mjs";
import { RETURNING_VISITOR } from "./helpers/returning-visitor.mjs";

const [executable, axePath] = process.argv.slice(2);
if (!executable || !axePath) throw new Error("usage: node tests/study-browser-smoke.mjs <chrome> <axe.min.js>");
const axe = readFileSync(axePath, "utf8");
const study = await loadStudy();
const port = 19100 + Math.floor(Math.random() * 300), origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["scripts/serve-export.mjs", "--port", String(port)], { stdio: "ignore" });
const downloads = mkdtempSync(join(tmpdir(), "signrelay-study-dl-"));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, reason, attempts = 300) {
  for (let i = 0; i < attempts; i++) { if (await check()) return; await pause(50); }
  throw new Error(reason);
}
const checks = [];
let browser;
try {
  await until(async () => { try { return (await fetch(`${origin}/study`)).ok; } catch { return false; } }, "No /study route in this export (build with SIGNRELAY_INCLUDE_PRIVATE_CAPTURE=1)");
  browser = await startChrome(executable);
  await browser.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: downloads });
  await browser.send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
    window.__qa = { workers: [], requests: [] };
    const nativeFetch = window.fetch; window.fetch = (input, init) => { window.__qa.requests.push(String(input?.url ?? input) + ' ' + (init?.method ?? 'GET')); return nativeFetch(input, init); };
    const beacon = navigator.sendBeacon?.bind(navigator); if (beacon) navigator.sendBeacon = (url, data) => { window.__qa.requests.push('beacon ' + url); return beacon(url, data); };
    const NativeWorker = window.Worker;
    window.Worker = class {
      constructor(url, options) {
        if (!String(url).includes('recognition.worker.js')) return new NativeWorker(url, options);
        this.onmessage = this.onerror = this.onmessageerror = null; this.closed = false; this.session = 0; window.__qa.workers.push(this);
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
  })();` });
  await browser.send("Page.addScriptToEvaluateOnNewDocument", { source: RETURNING_VISITOR });
  await browser.send("Page.navigate", { url: `${origin}/study` });
  const evaluate = browser.evaluate;
  const button = text => `[...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(text)})`;
  const click = async text => { await until(() => evaluate(`!!${button(text)} && !${button(text)}.disabled`), `Button "${text}" not available`); await evaluate(`${button(text)}.click()`); };
  const disabled = text => evaluate(`${button(text)}?.disabled ?? null`);
  const setValue = (selector, value) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); })()`);
  const tick = index => evaluate(`document.querySelectorAll('[data-study-phase] input[type=checkbox]')[${index}].click()`);
  const progress = () => evaluate("document.querySelector('[data-study-progress]')?.textContent ?? ''");
  const observed = () => evaluate("[...document.querySelectorAll('[data-study-observations] li')].map(li => li.textContent)");
  async function runAxe(label) {
    await evaluate(axe);
    const violations = await evaluate(`axe.run(document.querySelector('[data-study-phase]'), { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] } }).then(r => r.violations.map(v => v.id + ':' + v.impact))`);
    assert.deepEqual(violations, [], `axe violations on the study panel (${label})`);
  }

  // 1. Consent gate: nothing starts without both required consents and a consent reference.
  await until(() => evaluate("!!document.querySelector('[data-study-phase=setup]')"), "Study setup missing");
  await until(() => evaluate("document.querySelectorAll('[data-study-phase] input[type=checkbox]').length === 3"), "Consent boxes missing");
  await until(() => evaluate(`Object.keys(document.querySelector("input[placeholder='ss-2026-11-p01']") ?? {})
    .some(key => key.startsWith("__reactFiber"))`), "Study setup did not hydrate");
  assert.deepEqual(await evaluate("[...document.querySelectorAll('[data-study-phase] input[type=checkbox]')].map(c => c.checked)"), [false, false, false], "A consent box starts ticked");
  await setValue("input[placeholder='ss-2026-11-p01']", "ss-2026-11-p01");
  await until(() => evaluate("!!document.querySelector('[data-study-split]')?.dataset.studySplit"), "Split not computed");
  const split = await evaluate("document.querySelector('[data-study-split]').dataset.studySplit");
  const selects = await evaluate("[...document.querySelectorAll('[data-study-phase] select')].length");
  assert.equal(selects, 5);
  await evaluate(`(() => { const s = [...document.querySelectorAll('[data-study-phase] select')];
    const set = (el, v) => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('change', { bubbles: true })); };
    set(s[1], 'right'); set(s[2], 'laptop'); set(s[3], 'front-eye-level'); set(s[4], 'even-bright'); })()`);
  assert.equal(await disabled("Start session"), true, "Session could start without consent");
  await tick(0); await tick(1);
  assert.equal(await disabled("Start session"), true, "Session could start without a consent reference");
  await setValue("input[placeholder='c-0007']", "c-0001");
  await tick(2); // sharing consent
  await until(async () => (await disabled("Start session")) === false, "Session did not become startable with consent");
  await runAxe("setup");
  checks.push(`consent gate: all boxes start unticked; no start without participation, logging consent and a consent reference; split fixed from the pseudonym (${split}); axe clean`);
  await click("Start session");
  await until(() => evaluate("!!document.querySelector('[data-study-phase=running]')"), "Session did not start");
  assert.equal(await evaluate("document.activeElement?.id"), "study-title", "Focus did not move to the task heading");

  // 2. Workspace below: start ASL with the camera.
  await until(() => evaluate("!!document.querySelector('.language-row [role=radio]')"), "Workspace welcome missing");
  await until(async () => { await evaluate("[...document.querySelectorAll('[role=radio]')].find(b=>b.textContent.includes('British'))?.click()");
    return evaluate("document.querySelector('[role=radio][aria-checked=true]')?.textContent.includes('British')"); }, "Workspace did not hydrate");
  await evaluate("[...document.querySelectorAll('[role=radio]')].find(b=>b.textContent.includes('American'))?.click()");
  await click("Start signing");
  await until(() => evaluate("document.querySelector('.status-badge')?.textContent === 'Active'"), "Camera did not start", 600);
  await until(() => evaluate("!!window.__qaLive()"), "Worker missing");

  // 3. Outside a task window nothing is recorded.
  await evaluate("window.__qaConfirm('NO', 'starter')");
  await pause(300);
  await evaluate(`[...document.querySelectorAll('[data-suggestion-action=dismiss]')].forEach(b => b.click())`);
  const firstTask = await evaluate("document.querySelector('[data-study-task]').dataset.studyTask");
  assert.match(firstTask, /^starter:/, "First block is not the starter signs");
  const expected = firstTask.split(":")[1];
  await click("Start task");
  assert.match(await evaluate("document.querySelector('[data-study-phase]').textContent"), /Nothing yet\./, "An event from before the task was recorded");
  checks.push("events outside a task window are not recorded");

  // 4. A correct suggestion the participant adds.
  await evaluate(`window.__qaConfirm(${JSON.stringify(expected)}, 'starter')`);
  await until(async () => (await observed()).some(t => t.includes("suggested")), "Suggestion not observed by the study");
  await pause(700);
  await evaluate(`document.querySelector('[data-suggestion-action=accept]').click()`);
  await until(async () => (await observed()).some(t => t.includes("added by you")), "Acceptance not observed");
  await click("Done");
  await evaluate(`document.querySelector('input[name=study-outcome][value=correct]').click()`);
  await click("Save and next");
  await until(async () => (await progress()).startsWith("1 of 41 tasks recorded · first output matched the expected sign in 1"), "First trial not scored as correct");
  checks.push(`correct starter suggestion (${expected}) added and scored: raw correct, entered correct`);

  // 5. A wrong suggestion the participant adds anyway (habitual acceptance is measured).
  const second = await evaluate("document.querySelector('[data-study-task]').dataset.studyTask");
  const wrong = second.split(":")[1] === "PLEASE" ? "SORRY" : "PLEASE";
  await click("Start task");
  await evaluate(`window.__qaConfirm(${JSON.stringify(wrong)}, 'starter')`);
  await until(async () => (await observed()).some(t => t.includes("suggested")), "Wrong suggestion not observed");
  await pause(700);
  await evaluate(`document.querySelector('[data-suggestion-action=accept]').click()`);
  await click("Done");
  await evaluate(`document.querySelector('input[name=study-outcome][value=wrong-word]').click()`);
  await setValue("[data-study-phase] fieldset select", second.split(":")[1]);
  await runAxe("reporting");
  await click("Save and next");
  await until(async () => /words you added that were wrong: 1/.test(await progress()), "Wrong acceptance not counted");
  checks.push("wrong suggestion added by the participant is counted as a wrong word they added (habitual-acceptance measure); correction recorded from the gloss list; axe clean");

  // 6. A personal sign is reported only as PERSONAL.
  await click("Start task");
  await evaluate("window.__qaConfirm('MY BROTHER SAM', 'personal')");
  await until(async () => (await observed()).some(t => t.startsWith("Your sign")), "Personal sign not observed");
  await click("Done");
  await evaluate(`document.querySelector('input[name=study-outcome][value=unexpected-word]').click()`);
  await click("Save and next");

  // 7. Skip to the end, download, and validate the file with the same library.
  for (let i = 3; i < 41; i++) await click("Skip task");
  await until(() => evaluate("!!document.querySelector('[data-study-phase=finished]')"), "Session did not finish");
  await click("Download study log");
  await until(() => readdirSync(downloads).some(f => f.endsWith(".study.json")), "No study log downloaded");
  const file = readdirSync(downloads).find(f => f.endsWith(".study.json"));
  assert.equal(file, "ss-2026-11-p01-session1.study.json");
  const log = JSON.parse(readFileSync(join(downloads, file), "utf8"));
  assert.deepEqual(study.validateStudySession(log, { knownSplit: split }), [], "The downloaded log does not validate");
  assert.equal(log.trials.length, 3);
  assert.equal(JSON.stringify(log).includes("BROTHER"), false, "A personal sign's text was exported");
  assert.equal(log.build.starter_output, "suggest");
  assert.deepEqual(study.classifyTrial(log.trials[1]).transcript.wrongAccepted, 1);
  checks.push("downloaded log validates (strict schema, pseudonym, relative times), holds 3 recorded trials, no personal-sign text, build policy 'suggest'");

  // 8. Nothing persisted or sent.
  const stored = await evaluate("JSON.stringify(Object.keys(localStorage)) + JSON.stringify(Object.keys(sessionStorage))");
  assert.equal(/study|ss-2026/.test(stored), false, `Study data persisted: ${stored}`);
  const requests = await evaluate("window.__qa.requests");
  assert.ok(requests.every(r => r.startsWith("/") || r.startsWith(origin)) && !requests.some(r => / POST$/.test(r) || r.startsWith("beacon")), `Unexpected request: ${requests.join(", ")}`);
  await click("End session and delete log");
  await until(() => evaluate("!!document.querySelector('[data-study-phase=setup]')"), "Session not ended");
  assert.deepEqual(await evaluate("[...document.querySelectorAll('[data-study-phase] input[type=checkbox]')].map(c => c.checked)"), [false, false, false], "Consent not reset");
  checks.push("nothing stored in localStorage/sessionStorage, no POST or beacon; ending the session deletes the log and resets consent");
  console.log("STUDY-SMOKE", JSON.stringify({ passed: checks.length, checks }));
} finally {
  await browser?.close();
  server.kill();
  rmSync(downloads, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 });
}
