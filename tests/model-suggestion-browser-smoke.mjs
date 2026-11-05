// Output safety (research-model and starter-rule suggestions) in the real workspace (production export, real camera pipeline
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
const server = spawn(process.execPath, ["scripts/serve-export.mjs", "--host", "127.0.0.1", "--port", String(port)], { stdio: "ignore" });
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
    window.__qaSend = (message, session) => { const w = window.__qaLive(); w.onmessage?.({ data: { session: session ?? w.session, timestamp: performance.now(), ...message } }); };
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
  // Buttons of the card for a given word (cards are in signing order, oldest first).
  const actionFor = (word, kind) => `[...document.querySelectorAll('.model-suggestion')].find(c => c.querySelector('strong')?.textContent === ${JSON.stringify(word)})?.querySelector('[data-suggestion-action=${kind}]')`;
  const cards = () => evaluate("[...document.querySelectorAll('.model-suggestion')].map(c => c.dataset.suggestionSource + ':' + c.querySelector('strong').textContent)");
  const announcements = () => evaluate("[...document.querySelectorAll('.sr-only[role=status]')].map(n => n.textContent).join(' | ')");
  const missed = () => evaluate("document.querySelector('[data-suggestions-missed]')?.textContent ?? ''");
  const waiting = () => evaluate("document.querySelector('[data-suggestions-waiting]')?.textContent ?? ''");
  const armedOf = word => evaluate(`${actionFor(word, "accept")}?.getAttribute('aria-disabled') === 'false'`);
  // Real pointer input at the control's on-screen centre (scrolled into view first).
  const centre = selector => evaluate(`(() => { const el = ${selector}; el.scrollIntoView({ block: "center", behavior: "instant" }); const r = el.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
  const moveMouse = ([x, y]) => browser.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  const tap = async ([x, y]) => { for (const type of ["mousePressed", "mouseReleased"]) await browser.send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 }); };
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

  // 1. A research-model suggestion is shown, labelled, not inserted, not spoken, announced as not added.
  const focusBefore = await evaluate("document.activeElement?.outerHTML.slice(0, 60)");
  await evaluate("window.__qaSuggest('s1', 'BOOK')");
  await until(async () => (await card()) !== null, "Suggestion not shown");
  assert.match(await evaluate("document.querySelector('.model-suggestion').textContent"), /Experimental suggestion · ASL research model.*Book/s);
  assert.match(await evaluate("document.querySelector('.model-suggestions').textContent"), /Not in the transcript\. Add a word only if it is what you signed\./);
  assert.deepEqual(await entries(), [], "A suggestion entered the transcript");
  assert.deepEqual(await evaluate("window.__qa.spoken"), [], "A suggestion was spoken");
  assert.match(await announcements(), /Experimental suggestion: Book\. Not added\./);
  assert.equal(await evaluate("document.activeElement?.outerHTML.slice(0, 60)"), focusBefore, "Focus moved to the suggestion");
  assert.equal(await evaluate(`${action("accept")}.getAttribute('aria-disabled')`), "true", "Add is armed immediately");
  checks.push("research-model suggestion shown and labelled; transcript unchanged; nothing spoken (auto speak on); announced as not added; focus not moved");

  // 2. An immediate activation does nothing, even if the wall clock jumps forward.
  await evaluate(`(() => {
    const wallClock = Date.now;
    Date.now = () => wallClock() + 2000;
    try { ${action("accept")}.click(); } finally { Date.now = wallClock; }
  })()`);
  assert.deepEqual(await entries(), [], "An immediate tap accepted the suggestion");
  assert.deepEqual(await evaluate("window.__qa.spoken"), [], "An immediate tap spoke the suggestion");
  assert.match(await announcements(), /Not added yet\. Check the word, then press Add again\./, "An early press was not explained");
  checks.push("activation within 600 ms of appearing is ignored and explained to screen readers, even after a wall-clock jump");

  // 3. Keyboard: Enter adds once; an extra click adds nothing; focus returns to the transcript.
  await pause(700);
  assert.equal(await evaluate(`${action("accept")}.getAttribute('aria-disabled')`), "false");
  await evaluate(`${action("accept")}.scrollIntoView({ block: "center" })`);
  await evaluate(`${action("accept")}.focus()`);
  const box = await evaluate(`(() => { const r = ${action("accept")}.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
  await browser.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
  await browser.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await until(async () => (await entries()).length === 1, "Accepted word missing (keyboard)");
  assert.equal(await evaluate("document.activeElement?.id"), "transcript-title", "Focus did not return to the transcript");
  await browser.send("Input.dispatchMouseEvent", { type: "mousePressed", x: box[0], y: box[1], button: "left", clickCount: 1 });
  await browser.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: box[0], y: box[1], button: "left", clickCount: 1 });
  await pause(200);
  assert.deepEqual(await entries(), ["Book · added by you (research model)"], "Double activation added twice or the provenance is missing");
  assert.equal(await card(), null, "Suggestion still shown after acceptance");
  assert.deepEqual(await evaluate("window.__qa.spoken"), ["Book"], "The accepted word must be spoken exactly once with auto speak on");
  checks.push("keyboard Enter adds once; an extra click adds nothing; provenance shown; spoken once only after acceptance; focus returns to the transcript");

  // 4. Dismiss removes it without adding or speaking.
  await evaluate("window.__qaSuggest('s2', 'CHAIR')"); await until(async () => (await card())?.endsWith(":s2"), "Second suggestion missing");
  await evaluate(`${action("dismiss")}.click()`);
  await until(async () => (await card()) === null, "Dismiss did not remove the suggestion");
  assert.deepEqual(await entries(), ["Book · added by you (research model)"]); assert.deepEqual(await evaluate("window.__qa.spoken"), ["Book"]);
  checks.push("dismiss removes the suggestion; nothing added or spoken");

  // 5. Production policy: a starter-rule word is a "Possible sign" suggestion, not inserted, not spoken.
  await evaluate("window.__qaConfirm('HELLO', 'starter')");
  await until(async () => (await cards()).includes("starter:Hello"), "Starter word was not offered as a suggestion");
  assert.match(await evaluate("document.querySelector('.model-suggestion.starter').textContent"), /Possible sign · built-in sign rules.*Hello/s);
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.model-suggestion.starter')).borderTopStyle"), "dashed", "A pending word is not drawn as an outline");
  assert.deepEqual(await entries(), ["Book · added by you (research model)"], "A starter word entered the transcript automatically");
  assert.deepEqual(await evaluate("window.__qa.spoken"), ["Book"], "A starter suggestion was spoken");
  assert.match(await announcements(), /Possible sign: Hello\. Not added\./);
  checks.push("starter-rule word (production policy) offered as a distinct 'Possible sign' suggestion; not inserted, not spoken");

  await evaluate("window.__qaConfirm('UNATTRIBUTED')");
  await pause(150);
  assert.deepEqual(await entries(), ["Book · added by you (research model)"], "A word with no provenance entered the transcript");
  assert.deepEqual(await evaluate("window.__qa.spoken"), ["Book"], "A word with no provenance was spoken");
  assert.deepEqual(await cards(), ["starter:Hello"], "A word with no provenance was offered");
  assert.doesNotMatch(await announcements(), /Unattributed/i);
  checks.push("a cached-worker confirmation with no provenance is ignored");

  // 6. Personal signs stay automatic and do not withdraw pending suggestions.
  await evaluate("window.__qaConfirm('MY SIGN', 'personal')");
  await until(async () => (await entries()).includes("My sign · your sign"), "Personal confirmation missing");
  assert.deepEqual(await evaluate("window.__qa.spoken"), ["Book", "My sign"], "Personal sign not spoken automatically");
  assert.ok((await cards()).includes("starter:Hello"), "A personal sign withdrew a pending suggestion");
  checks.push("personal-sign word unchanged: inserted, labelled 'your sign', auto-spoken; pending suggestions kept");

  // 7. Accepting the earlier suggestion places it where it was signed (before the later personal word),
  //    comparing on the camera frame clock that confirmed words carry.
  await pause(700);
  await evaluate(`${actionFor("Hello", "accept")}.click()`);
  await until(async () => (await entries()).length === 3, "Starter suggestion not added");
  assert.deepEqual(await entries(), ["Book · added by you (research model)", "Hello · added by you (sign rules)", "My sign · your sign"], "Accepted word not placed in signing order");
  checks.push("accepted starter word placed in signing order, labelled 'added by you (sign rules)'");

  // 8. Rapid signing, nobody touching the cards: signing order, oldest first; a fourth word replaces the
  //    oldest card and is listed and announced as not added (no silent eviction).
  for (const word of ["PLEASE", "SORRY", "YES", "NO"]) await evaluate(`window.__qaConfirm('${word}', 'starter')`);
  await until(async () => (await cards()).length === 3 && (await cards()).includes("starter:No"), "Rapid suggestions missing");
  assert.deepEqual(await cards(), ["starter:Sorry", "starter:Yes", "starter:No"], "Not in signing order");
  assert.equal(await missed(), "Not added: Please", "The replaced card was not listed as not added");
  assert.match(await announcements(), /Possible sign: No\. Not added\. Please was not added and has been replaced\./);
  checks.push("rapid signing: cards in signing order (new ones below); a fourth word replaces the oldest, which is listed and announced as not added");

  // 8b. Layout-shift guard: after adding the first card, the card that moves into its place is re-armed, so a
  //     second tap at the same spot adds nothing.
  await pause(700);
  const firstAdd = await centre(actionFor("Sorry", "accept"));
  await tap(firstAdd);
  await until(async () => (await entries()).includes("Sorry · added by you (sign rules)"), "First card could not be added by tap");
  assert.deepEqual(await cards(), ["starter:Yes", "starter:No"]);
  assert.equal(await armedOf("Yes"), false, "A card that moved under the pointer was not re-armed");
  await tap(await centre(actionFor("Yes", "accept")));
  await pause(100);
  assert.equal((await entries()).some(e => e.startsWith("Yes")), false, "A double tap added the card that moved into place");
  await until(() => armedOf("Yes"), "Moved card never re-armed");
  checks.push("a card that moves up after another is answered is re-armed for 600 ms; a double tap does not add it");

  // 8c. A repeated word is counted on its own card, in place.
  await evaluate("window.__qaConfirm('NO', 'starter')");
  await until(async () => (await evaluate(`${actionFor("No", "accept")}?.closest('.model-suggestion').querySelector('[data-suggestion-repeats]')?.textContent ?? ''`)) === "Recognised 2 times", "Repeat not counted");
  assert.deepEqual(await cards(), ["starter:Yes", "starter:No"], "A repeat moved or duplicated a card");
  assert.match(await announcements(), /Possible sign again: No\. Still not added\./);
  checks.push("a repeated word is counted on its own card ('Recognised 2 times') without moving or duplicating it");

  // 8d. While the pointer is on the cards, a new word waits instead of pushing a card away.
  await evaluate("window.__qaConfirm('WATER', 'starter')");
  await until(async () => (await cards()).length === 3, "Third card missing");
  await moveMouse(await centre(actionFor("Yes", "accept")));
  await pause(100);
  await evaluate("window.__qaConfirm('HELP', 'starter')");
  await until(async () => (await waiting()) === "1 more waiting", "A word arriving during interaction did not wait");
  assert.deepEqual(await cards(), ["starter:Yes", "starter:No", "starter:Water"], "A card was pushed away under the pointer");
  await tap(await centre(actionFor("Yes", "accept")));
  await until(async () => (await entries()).includes("Yes · added by you (sign rules)"), "Yes could not be added");
  await until(async () => (await cards()).includes("starter:Help"), "The waiting word was not shown when a slot freed");
  assert.deepEqual(await cards(), ["starter:No", "starter:Water", "starter:Help"], "The waiting word was not added below");
  await moveMouse([5, 5]);
  checks.push("while pointing at the cards a new word waits ('1 more waiting'); it appears below when a card is answered");

  // 8e. Keyboard focus keeps the cards held when the pointer leaves the panel.
  await evaluate(`${actionFor("No", "accept")}.focus()`);
  await moveMouse(await centre(actionFor("No", "accept")));
  await moveMouse([5, 5]);
  await evaluate("window.__qaSuggest('held-focus', 'BAG')");
  await until(async () => (await waiting()) === "1 more waiting", "Leaving the panel with the pointer released a focused card");
  assert.deepEqual(await cards(), ["starter:No", "starter:Water", "starter:Help"]);
  assert.equal(await evaluate(`document.activeElement === ${actionFor("No", "accept")}`), true, "The focused button lost focus");
  checks.push("a focused card remains held after the pointer leaves the suggestion panel");

  // 8f. A pointer still in the panel keeps the cards held after focus leaves.
  await moveMouse(await centre(actionFor("No", "accept")));
  await evaluate("document.getElementById('transcript-title').focus({ preventScroll: true })");
  await evaluate("window.__qaSuggest('held-pointer', 'PEN')");
  await until(async () => (await waiting()) === "2 more waiting", "Blurring the focused card released the pointer hold");
  assert.deepEqual(await cards(), ["starter:No", "starter:Water", "starter:Help"]);
  checks.push("a hovered card remains held after keyboard focus leaves the suggestion panel");
  await moveMouse([5, 5]);
  for (const word of ["No", "Water", "Help", "Bag", "Pen"]) { await until(() => armedOf(word), `${word} not armed`); await evaluate(`${actionFor(word, "dismiss")}.click()`); }
  await until(async () => (await cards()).length === 0, "Cards not dismissed");

  // 9. Any language's research-model confirmation (e.g. an old cached worker) is demoted, never inserted.
  await evaluate("window.__qaConfirm('GOOD', 'model')");
  await until(async () => (await cards()).includes("model:Good"), "Model confirmation was not demoted to a suggestion");
  assert.equal((await entries()).some(e => e.startsWith("Good")), false, "A model-only confirmation entered the transcript");
  checks.push("a model-sourced 'confirmed' message is demoted to a suggestion: not inserted, not spoken");

  // 10. A suggestion from a replaced session is dropped.
  const live = await evaluate("window.__qaLive().session");
  const before = await cards();
  await evaluate(`window.__qaSuggest('old', 'STALE', ${live - 1})`); await pause(150);
  assert.deepEqual(await cards(), before, "A stale-session suggestion was shown");
  checks.push("suggestion from a replaced session ignored");

  // 11. Camera interruption withdraws every suggestion.
  await click("Pause camera");
  await until(async () => (await card()) === null, "Pausing the camera did not withdraw the suggestions");
  await click("Start camera"); await until(active, "Camera did not restart", 600);
  await until(() => evaluate("!!window.__qaLive()"), "Worker missing after restart");
  checks.push("camera pause withdraws every suggestion");

  // 12. Worker failure withdraws them.
  await evaluate("window.__qaSuggest('s5', 'LAMP')"); await until(async () => (await card()) !== null, "s5 missing");
  await evaluate("window.__qaLive().onerror?.(new Event('error'))");
  await until(async () => (await card()) === null, "A worker failure did not withdraw the suggestion");
  checks.push("worker failure withdraws the suggestions");

  // 13. Expiry after 12 s, paused while the pointer is on the card (WCAG 2.2.1), with a grace period after.
  await until(() => evaluate("!!window.__qaLive() && !window.__qaLive().closed"), "Worker did not recover", 400);
  await pause(1500);
  await evaluate("window.__qaSuggest('s6', 'DOOR')"); await until(async () => (await card()) !== null, "s6 missing");
  await moveMouse(await centre(actionFor("Door", "dismiss")));
  await pause(13000);
  assert.ok((await cards()).includes("model:Door"), "A card expired while the pointer was on it");
  await moveMouse([5, 5]);
  await pause(2500);
  assert.ok((await cards()).includes("model:Door"), "No grace period after the pointer left");
  await until(async () => (await card()) === null, "The card did not expire after the grace period", 80);
  assert.match(await missed(), /Not added: .*Door/, "An expired card was not listed as not added");
  assert.match(await announcements(), /Not added, timed out: Door\./);
  checks.push("expiry pauses while the pointer is on a card, resumes with a 4 s grace period, then the card is listed and announced as not added");
  const sorted = await evaluate("document.querySelector('.model-suggestions') ? 'shown' : 'none'");
  assert.equal(sorted, "shown", "Missed note panel unexpectedly removed");

  // 14. Mobile: three cards, every control at least 44 px, no overflow.
  for (const word of ["WATER", "HELP"]) await evaluate(`window.__qaConfirm('${word}', 'starter')`);
  await evaluate("window.__qaSuggest('s7', 'TABLE')");
  await until(async () => (await cards()).length === 3, "three cards missing");
  await browser.send("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 1, mobile: true });
  await pause(300);
  const sizes = await evaluate("[...document.querySelectorAll('[data-suggestion-action]')].map(b => { const r = b.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })");
  for (const [w, h] of sizes) assert.ok(w >= 44 && h >= 44, `suggestion control ${w}x${h} under 44 px`);
  assert.ok(await evaluate("document.documentElement.scrollWidth <= 375"), "Suggestions overflow a phone viewport");
  checks.push(`phone (375 px), three cards: ${sizes.length} controls, smallest ${Math.min(...sizes.map(s => s[1]))} px high; no horizontal overflow`);
  await browser.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

  // 15. Language switch withdraws them; saved history keeps provenance.
  await evaluate(`(() => { const s = document.querySelector('select[aria-label="Change sign language"]'); s.value = 'bsl'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await until(async () => (await card()) === null, "Switching language did not withdraw the suggestions");
  const saved = await evaluate("JSON.parse(localStorage.getItem('signrelay.history.v1') || '[]')[0]");
  assert.equal(saved.language, "asl");
  assert.deepEqual(saved.entries.map(e => [e.text, e.source, e.acceptedBy ?? null]),
    [["Book", "model", "user"], ["Hello", "starter", "user"], ["My sign", "personal", null], ["Sorry", "starter", "user"], ["Yes", "starter", "user"]]);
  checks.push("language switch withdraws the suggestions; saved history keeps source and acceptedBy=user");

  // 16. BSL research-model words are suggestions too, labelled with their model.
  await until(() => evaluate("!!window.__qaLive()"), "BSL worker missing");
  await evaluate("window.__qaSend({ type: 'confirmed', text: 'House', gloss: 'HOUSE', confidence: 0.9, source: 'model' })");
  await until(async () => (await cards()).includes("model:House"), "BSL model word was not offered as a suggestion");
  assert.match(await evaluate("document.querySelector('.model-suggestion').textContent"), /BSL research model/);
  assert.deepEqual(await entries(), [], "A BSL model word entered the transcript");
  checks.push("BSL research-model word offered as a suggestion labelled with its model; not inserted");

  // 17. Clear local data withdraws unaccepted suggestions as well as saved history.
  await evaluate("document.querySelector('.privacy-disclosure').open = true");
  await click("Clear local data");
  await until(async () => (await card()) === null, "A suggestion was still actionable after clearing local data");
  assert.deepEqual(await entries(), [], "Clearing local data added a pending suggestion");
  assert.equal(await evaluate("localStorage.getItem('signrelay.history.v1')"), null, "Saved history was not cleared");
  checks.push("clearing local data withdraws pending suggestions and removes saved transcript history");

  assert.ok((await evaluate("window.__qa.urls")).some(u => u.includes("recognition.worker.js?v=output-policy-2")), "Worker URL version not updated");
  console.log("MODEL-SUGGESTION-SMOKE", JSON.stringify({ passed: checks.length, checks }));
} finally { await browser?.close(); server.kill(); }
