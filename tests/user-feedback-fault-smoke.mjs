// User-facing outcomes under injected faults on the rehearsal export: storage
// that commits but cannot be re-read, browser storage that throws, and a
// browser without speech synthesis. Synthetic landmarks are recorded as a
// personal example. Each message must match what actually happened.
//   node tests/user-feedback-fault-smoke.mjs /path/to/chrome
import assert from "node:assert/strict";
import { fixtures, openRehearsal, until } from "./rehearsal-harness.mjs";

const executable = process.argv[2];
if (!executable) throw new Error("Usage: node tests/user-feedback-fault-smoke.mjs <chrome>");
const { sequence } = await fixtures();
// Faults are switched on per page through sessionStorage, so a reload keeps them.
const h = await openRehearsal(executable, { extraInit: `
  const fault = name => sessionStorage.getItem('qa-fault') === name;
  const getAll = IDBObjectStore.prototype.getAll;
  IDBObjectStore.prototype.getAll = function (...args) {
    // Only list reads (readonly transactions) fail: the save's own readwrite transaction still commits.
    if (fault('reload') && this.transaction.mode === 'readonly') throw new DOMException('Injected read failure', 'UnknownError');
    return getAll.apply(this, args);
  };
  if (fault('nospeech')) { delete window.speechSynthesis; delete Window.prototype.speechSynthesis; }
  if (fault('localStorage')) for (const name of ['getItem', 'setItem', 'removeItem']) {
    const original = Storage.prototype[name];
    Storage.prototype[name] = function (...args) {
      if (this === window.localStorage) throw new DOMException('Injected storage failure', 'SecurityError');
      return original.apply(this, args);
    };
  }
` });
const checks = [];
const message = () => h.evaluate("document.querySelector('.calibration-message.saved, .calibration-message.error')?.textContent ?? ''");
const stored = () => h.evaluate(`new Promise((resolve, reject) => { const open = indexedDB.open('signrelay-personal-vocabulary', 1);
  open.onerror = () => reject(open.error);
  open.onsuccess = () => { const tx = open.result.transaction('templates', 'readwrite'); const request = tx.objectStore('templates').getAll();
    request.onsuccess = () => { resolve(request.result.map(t => t.gloss)); open.result.close(); }; request.onerror = () => reject(request.error); }; })`);
async function record(word) {
  await h.evaluate(`(() => { const input = document.querySelector('[aria-label="Word or short phrase to teach"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(word)});
    input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await h.click("Select word");
  await h.click("Record example");
  await until(() => h.evaluate("!!document.querySelector('.calibration-capture.recording')"), "Recording did not start");
  // Four seconds of continuous synthetic hands cover the 3 s recording window.
  await h.play(sequence(["HELLO", "HELLO", "HELLO", "HELLO"], 0));
  await until(async () => (await message()) !== "", "No outcome was shown for the recording", 200);
  return message();
}
try {
  await h.open();
  await h.start();

  // 1. The example commits, then reloading the list fails.
  await h.evaluate("sessionStorage.setItem('qa-fault', 'reload')");
  await h.open();
  await h.start();
  const afterReloadFailure = await record("Pizza");
  assert.deepEqual(await stored(), ["PIZZA"], "The example should be stored");
  assert.ok(!/could not save/i.test(afterReloadFailure), `A stored example was reported as not saved: "${afterReloadFailure}"`);
  assert.match(afterReloadFailure, /saved/i, "The message must say the example was saved");
  checks.push({ check: "saved example with a failed list reload is reported as saved", message: afterReloadFailure });

  // 2. Removing a word commits, then reloading the list fails: it must still say removed and stop showing it.
  await h.evaluate("sessionStorage.removeItem('qa-fault')");
  await h.open();
  await h.start();
  await until(() => h.evaluate("[...document.querySelectorAll('.vocabulary-grid button')].some(b => b.textContent.includes('Pizza') && b.classList.contains('trained'))"), "Saved word did not load after a reload");
  await h.evaluate("sessionStorage.setItem('qa-fault', 'reload')");
  await h.evaluate("[...document.querySelectorAll('.vocabulary-grid button')].find(b => b.textContent.includes('Pizza')).click()");
  await h.click("Remove");
  await until(async () => /removed|could not/i.test(await h.evaluate("document.querySelector('.calibration-message[role=status]')?.textContent ?? ''")), "No outcome for Remove");
  const removed = await h.evaluate("document.querySelector('.calibration-message[role=status]').textContent");
  assert.deepEqual(await stored(), [], "The examples should be deleted");
  assert.ok(!/could not be removed/i.test(removed), `A committed removal was reported as failed: "${removed}"`);
  assert.equal(await h.evaluate("[...document.querySelectorAll('.vocabulary-grid button.trained')].some(b => b.textContent.includes('Pizza'))"), false, "The removed word is still shown as taught");
  checks.push({ check: "committed removal with a failed list reload is reported as removed", message: removed });

  // 3. Speak in a browser without speech synthesis says so instead of doing nothing.
  await h.evaluate("sessionStorage.setItem('qa-fault', 'nospeech')");
  await h.open();
  await h.start();
  assert.equal(await h.evaluate("'speechSynthesis' in window"), false);
  await h.play(sequence(["HELLO"]));
  await until(async () => (await h.words()).length > 0, "No transcript entry to speak");
  await h.click("Speak");
  await until(() => h.evaluate("[...document.querySelectorAll('[role=status]')].some(n => /speech output is not available/i.test(n.textContent))"), "Speak without speech synthesis gave no feedback", 50);
  checks.push({ check: "Speak without the Web Speech API explains why nothing is heard" });

  // 4. Clear local data while localStorage throws: it must not claim transcripts or settings were cleared.
  await h.evaluate("sessionStorage.setItem('qa-fault', 'localStorage')");
  await h.open();
  await h.start();
  await h.click("Clear local data");
  await until(() => h.evaluate("[...document.querySelectorAll('[role=status]')].some(n => /cleared|could not/i.test(n.textContent))"), "No outcome for Clear local data");
  const cleared = await h.evaluate("[...document.querySelectorAll('[role=status]')].map(n => n.textContent).find(t => /cleared|could not/i.test(t))");
  assert.ok(!/transcripts(,| and) settings (and personal signs )?were cleared/i.test(cleared), `Clear local data claimed success while browser storage failed: "${cleared}"`);
  assert.match(cleared, /could not/i);
  assert.deepEqual(await stored(), [], "Personal signs in IndexedDB should still be cleared");
  checks.push({ check: "Clear local data reports a localStorage failure instead of success", message: cleared });

  const errors = h.browser.errors.filter(error => typeof error === "string" && !error.includes("Injected"));
  assert.deepEqual(errors, [], "Uncaught page exceptions");
  console.log(JSON.stringify({ passed: true, checks, environment: "headless Chromium, rehearsal build with synthetic landmarks and injected storage faults" }));
} finally { await h.close(); }
