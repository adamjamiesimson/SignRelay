// Personal vocabulary at 30, 150 and 300 saved ASL examples on the rehearsal
// export, in real IndexedDB. Synthetic, valid templates are seeded directly
// (three examples per word, as the app keeps at most). Each size must load with
// the right count and reach the recognition worker exactly; at 300 the oldest
// word, beyond the listed 80, must be reachable through search and removable,
// and must not come back after a reload.
//   node tests/personal-vocabulary-scale-smoke.mjs /path/to/chrome
import assert from "node:assert/strict";
import { openRehearsal, until } from "./rehearsal-harness.mjs";

const executable = process.argv[2];
if (!executable) throw new Error("Usage: node tests/personal-vocabulary-scale-smoke.mjs <chrome>");
// Record how many templates each configuration sends to the recognition worker.
const h = await openRehearsal(executable, { extraInit: `
  window.__templatesSent = [];
  const post = Worker.prototype.postMessage;
  Worker.prototype.postMessage = function (message, transfer) {
    if (message?.type === 'templates') window.__templatesSent.push(Array.isArray(message.templates) ? message.templates.length : message.templates.meta.length);
    return post.call(this, message, transfer);
  };
` });
const database = body => h.evaluate(`new Promise((resolve, reject) => { const open = indexedDB.open('signrelay-personal-vocabulary', 1);
  open.onupgradeneeded = () => open.result.createObjectStore('templates', { keyPath: 'id' });
  open.onerror = () => reject(open.error);
  open.onsuccess = () => { const db = open.result, tx = db.transaction('templates', 'readwrite'), store = tx.objectStore('templates'); ${body} }; })`);
// The gloss is the upper-cased text, exactly as the app saves a typed word.
const seed = examples => database(`store.clear();
  for (let i = 0; i < ${examples}; i++) { const word = Math.floor(i / 3);
    store.put({ id: 'WORD ' + word + '-' + i, language: 'asl', gloss: 'WORD ' + word, text: 'Word ' + word, createdAt: 1700000000000 + i,
      frames: Array.from({ length: 24 }, (_, f) => Array.from({ length: 240 }, (_, k) => Math.sin(word * 7 + f * 0.3 + k * 0.01))) }); }
  tx.oncomplete = () => { db.close(); resolve(true); }; tx.onerror = () => reject(tx.error);`);
const stored = () => database(`const request = store.getAll();
  request.onsuccess = () => { resolve(request.result.map(t => t.gloss)); db.close(); }; request.onerror = () => reject(request.error);`);
const taught = () => h.evaluate("Number(document.querySelector('.vocabulary-disclosure')?.dataset.taught ?? -1)");
const listed = word => h.evaluate(`[...document.querySelectorAll('.vocabulary-grid button')].some(b => b.querySelector('span')?.textContent === ${JSON.stringify(word)})`);
const lastSent = () => h.evaluate("window.__templatesSent.at(-1)");
const checks = [];
try {
  await h.open();
  for (const examples of [30, 150, 300]) {
    const words = examples / 3;
    await seed(examples);
    await h.open();
    await h.start();
    await until(async () => (await taught()) === words, `${examples} examples: the page did not show ${words} taught words`);
    await until(async () => (await lastSent()) === examples, `${examples} examples: the recognition worker did not receive all of them`);
    checks.push({ check: `${examples} saved examples load as ${words} words and reach the worker` });
  }

  // 300 examples: "Word 0" is the oldest of 100 words and is not among the 80 listed.
  await h.evaluate("document.querySelector('.vocabulary-disclosure').open = true");
  assert.equal(await listed("Word 0"), false, "The oldest word should be beyond the listed 80");
  const search = "[aria-label='Search taught ASL signs']";
  assert.ok(await h.evaluate(`!!document.querySelector("${search}")`), "More than 80 taught ASL words are listed with no way to search for the rest");
  await h.evaluate(`(() => { const input = document.querySelector("${search}");
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Word 0');
    input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await until(() => listed("Word 0"), "Search did not find the oldest taught word");
  await h.evaluate("[...document.querySelectorAll('.vocabulary-grid button')].find(b => b.querySelector('span')?.textContent === 'Word 0').click()");
  await h.click("Remove");
  await until(async () => (await taught()) === 99, "Removing the oldest word was not reflected");
  const afterRemove = await stored();
  assert.equal(afterRemove.length, 297);
  assert.equal(afterRemove.filter(gloss => gloss === "WORD 0").length, 0, "Removed examples are still stored");
  await until(async () => (await lastSent()) === 297, "The recognition worker still has the removed examples");
  // Emptying the search must not hide the search box while the list is still long.
  await h.evaluate(`(() => { const input = document.querySelector("${search}");
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '');
    input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  assert.ok(await h.evaluate(`!!document.querySelector("${search}")`), "The search disappeared while 99 words are taught");
  checks.push({ check: "at 300 examples the oldest word is found by search and removed from storage and the worker" });

  await h.open();
  await h.start();
  await until(async () => (await taught()) === 99, "The removed word came back after a reload");
  await until(async () => (await lastSent()) === 297, "After a reload the worker did not receive exactly the 297 remaining examples");
  assert.equal((await stored()).length, 297, "Stored examples changed on reload");
  checks.push({ check: "the removal survives a reload; no examples are duplicated or resurrected" });

  const errors = h.browser.errors.filter(error => typeof error === "string");
  assert.deepEqual(errors, [], "Uncaught page exceptions");
  console.log(JSON.stringify({ passed: true, checks, environment: "headless Chromium, rehearsal build, synthetic templates in real IndexedDB; not a device measurement" }));
} finally { await h.close(); }
