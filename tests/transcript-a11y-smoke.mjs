// Transcript and accessibility checks on the rehearsal export with synthetic
// landmarks: rapid words, live-region announcements, speech pause/stop, full
// keyboard operation, touch-target sizes on a phone viewport and reduced
// motion. Software behaviour only; not a substitute for testing with
// assistive-technology users.
//   node tests/transcript-a11y-smoke.mjs /path/to/chrome
import assert from "node:assert/strict";
import { fixtures, openRehearsal, pause, until } from "./rehearsal-harness.mjs";

const executable = process.argv[2];
if (!executable) throw new Error("Usage: node tests/transcript-a11y-smoke.mjs <chrome>");
const { sequence } = await fixtures();
const h = await openRehearsal(executable, { extraInit: `
  window.__qa.announcements = [];
  const last = new WeakMap();
  new MutationObserver(() => {
    for (const node of document.querySelectorAll('[aria-live]')) {
      if (node.textContent && last.get(node) !== node.textContent) window.__qa.announcements.push(node.textContent);
      last.set(node, node.textContent);
    }
  }).observe(document, { subtree: true, childList: true, characterData: true });
  // Order of speech calls, to pin the current auto-speak policy.
  window.__qa.speech = [];
  if (window.speechSynthesis) {
    const speak = window.speechSynthesis.speak, cancel = window.speechSynthesis.cancel;
    window.speechSynthesis.speak = utterance => { window.__qa.speech.push('speak:' + utterance.text); speak(utterance); };
    window.speechSynthesis.cancel = () => { window.__qa.speech.push('cancel'); cancel(); };
  }` });
const checks = [];
try {
  // ?perf only adds the throughput readout, quoted if the rapid sequence fails.
  await h.open("/?perf");
  await h.start();

  // Rapid words: 250 ms rests (the shortest that keeps all six in synthetic tests).
  await h.evaluate("document.querySelector('.switch-row.prominent input')?.click()");
  await h.play(sequence(["HELLO", "THANK YOU", "PLEASE", "SORRY", "YES", "NO"], 250));
  await until(async () => !(await h.playing()), "Rapid sequence did not finish", 600);
  await pause(1500);
  const words = await h.words();
  // Below ~10 analysed frames/s a short stroke completion can reach the worker
  // only once, and two-evidence confirmation then drops the word
  // (docs/refinement/sprint-5/low-throughput.json). The readout tells a slow
  // environment apart from a regression.
  const throughput = await h.evaluate("document.querySelector('[data-perf]')?.textContent ?? ''");
  assert.deepEqual(words, ["Hello", "Thank you", "Please", "Sorry", "Yes", "No"], `Rapid words in order, no duplicates (${throughput})`);
  const announced = await h.evaluate("window.__qa.announcements.filter(a => a.startsWith('Confirmed:'))");
  assert.deepEqual(announced, words.map(word => `Confirmed: ${word}`), "Each confirmed word is announced once in a polite live region");
  assert.deepEqual(await h.evaluate("window.__qa.spoken"), words, "Each word spoken once");
  // Current policy (docs/refinement/sprint-5/speech-policy.md): each confirmed
  // word cancels whatever is still being spoken, then speaks. Changing it must
  // be a deliberate, documented decision.
  assert.deepEqual(await h.evaluate("window.__qa.speech.filter(call => call.startsWith('speak:') || call === 'cancel').slice(-12)"),
    words.flatMap(word => ["cancel", `speak:${word}`]), "Auto speak cancels the previous utterance before each confirmed word");
  checks.push({ check: "rapid words: order, single announcement, single speech", words: words.length });

  // Speech stops when the camera is paused.
  const cancels = await h.evaluate("window.__qa.cancels");
  await h.click("Pause camera");
  await until(() => h.evaluate(`window.__qa.cancels > ${cancels}`), "Pausing the camera must stop speech");
  checks.push({ check: "pausing the camera cancels speech" });

  // Keyboard: every workspace control is reachable with Tab and shows a visible focus indicator.
  const reached = new Set(), unfocusedStyle = [];
  await h.evaluate("document.activeElement?.blur(); window.scrollTo(0,0)");
  for (let i = 0; i < 80; i++) {
    await h.browser.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
    await h.browser.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
    const info = await h.evaluate(`(() => { const e = document.activeElement; if (!e || e === document.body) return null;
      const s = getComputedStyle(e); return { label: (e.getAttribute('aria-label') || e.textContent || e.tagName).trim().slice(0, 40),
      visible: (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== 'none' }; })()`);
    if (!info) continue;
    reached.add(info.label);
    if (!info.visible) unfocusedStyle.push(info.label);
  }
  for (const label of ["Start camera", "Speak", "Stop", "Copy", "Edit Hello", "Remove Hello", "Change language"])
    assert.ok([...reached].some(item => item.startsWith(label)), `Keyboard cannot reach ${label}`);
  assert.deepEqual([...new Set(unfocusedStyle)], [], "Focused controls without a visible focus indicator");
  checks.push({ check: "keyboard reaches every workspace control with visible focus", controls_reached: reached.size });

  // Keyboard editing of a transcript entry.
  await h.evaluate("[...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === 'Edit Hello').focus()");
  await h.browser.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
  await h.browser.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await until(() => h.evaluate("document.activeElement?.classList.contains('entry-editor')"), "Edit did not focus the editor");
  await h.browser.send("Input.insertText", { text: " there" });
  await h.browser.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
  await until(async () => (await h.words())[0] === "Hello there", "Keyboard edit was not saved");
  await until(() => h.evaluate("document.activeElement?.getAttribute('aria-label') === 'Edit Hello there'"),
    "Saving an edit with Enter dropped keyboard focus instead of returning it to the entry", 20);
  checks.push({ check: "keyboard edit of a transcript entry keeps focus on that entry" });

  // Touch targets on a phone viewport (WCAG 2.2 AA 2.5.8: at least 24×24 CSS px).
  await h.browser.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
  await pause(500);
  const targets = await h.evaluate(`[...document.querySelectorAll('main button, main input, main a, main summary, main select')]
    .filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; })
    .map(e => { const r = (e.type === 'checkbox' || e.type === 'radio') && e.closest('label') ? e.closest('label').getBoundingClientRect() : e.getBoundingClientRect();
      return { label: (e.getAttribute('aria-label') || e.textContent || e.type || e.tagName).trim().slice(0, 30), w: Math.round(r.width), h: Math.round(r.height) }; })`);
  const small = targets.filter(t => t.w < 24 || t.h < 24);
  assert.deepEqual(small, [], "Touch targets under 24×24 CSS px on a 390 px viewport");
  checks.push({ check: "touch targets ≥ 24×24 on a 390 px phone viewport", targets: targets.length, under_44px: targets.filter(t => t.w < 44 || t.h < 44).length });
  await h.browser.send("Emulation.clearDeviceMetricsOverride");

  // An edit that leaves no text removes the entry instead of keeping a blank.
  const key = async (name, code, keyCode) => {
    await h.browser.send("Input.dispatchKeyEvent", { type: "keyDown", key: name, code, windowsVirtualKeyCode: keyCode, ...(name === "Enter" ? { text: "\r" } : {}) });
    await h.browser.send("Input.dispatchKeyEvent", { type: "keyUp", key: name, code, windowsVirtualKeyCode: keyCode });
  };
  await h.evaluate("[...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === 'Edit Thank you').focus()");
  await key("Enter", "Enter", 13);
  await until(() => h.evaluate("document.activeElement?.classList.contains('entry-editor')"), "Edit did not focus the editor");
  await h.evaluate("document.activeElement.select()");
  await key("Backspace", "Backspace", 8);
  await key("Enter", "Enter", 13);
  await until(async () => !(await h.words()).includes("Thank you") && !(await h.words()).includes(""), "Emptied entry was kept");
  assert.deepEqual(await h.words(), ["Hello there", "Please", "Sorry", "Yes", "No"], "Only the emptied entry is removed");
  await until(() => h.evaluate("document.activeElement?.id === 'transcript-title'"), "Focus is lost after an edit removes the entry", 20);
  checks.push({ check: "emptying an entry removes it" });

  // Removing an entry keeps keyboard focus in the transcript and says what happened.
  await h.evaluate("[...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === 'Remove Please').focus()");
  await key("Enter", "Enter", 13);
  await until(async () => !(await h.words()).includes("Please"), "Remove did not remove the entry");
  assert.equal(await h.evaluate("document.activeElement?.id"), "transcript-title", "Focus is lost after removing an entry");
  assert.ok(await h.evaluate(`[...document.querySelectorAll('[role=status]')].some(n => n.textContent === 'Removed "Please".')`), "Removal is not announced");
  checks.push({ check: "remove keeps focus in the transcript and is announced" });

  // Save & clear stops any speech of the cleared transcript.
  const cancelsBeforeClear = await h.evaluate("window.__qa.cancels");
  await h.click("Speak");
  await h.click("Save & clear");
  await until(async () => (await h.words()).length === 0, "Save & clear did not clear the transcript");
  assert.ok(await h.evaluate(`window.__qa.cancels > ${cancelsBeforeClear + 1}`), "Save & clear must stop speech of the cleared transcript");
  checks.push({ check: "save & clear cancels speech" });

  // Reduced motion: no CSS animations or transitions keep running.
  await h.open();
  await pause(800);
  const runningByDefault = await h.evaluate("document.getAnimations().filter(a => a.playState === 'running').length");
  await h.browser.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await h.open();
  await pause(800);
  const running = await h.evaluate("document.getAnimations().filter(a => a.playState === 'running').length");
  assert.equal(running, 0, "Animations keep running with prefers-reduced-motion: reduce");
  checks.push({ check: "prefers-reduced-motion stops CSS animations and transitions", running_by_default: runningByDefault, running_with_reduce: running });

  // Preferences survive a reload (Auto speak was switched on above), and
  // Clear local data leaves no settings record behind.
  const storedSettings = () => h.evaluate("localStorage.getItem('signrelay.settings.v1')");
  assert.equal(JSON.parse(await storedSettings())?.autoSpeak, true, "Reloading the page overwrote the saved Auto speak preference");
  await h.start();
  assert.equal(await h.evaluate("document.querySelector('.switch-row.prominent input').checked"), true, "Auto speak was not restored after a reload");
  await h.click("Clear local data");
  await until(async () => (await storedSettings()) === null, "Clear local data left the settings record in storage");
  await pause(300);
  assert.equal(await storedSettings(), null, "Settings were written back right after Clear local data");
  await h.open();
  await pause(300);
  assert.equal(await storedSettings(), null, "Loading the page re-created a cleared settings record");
  checks.push({ check: "settings persist across reloads and stay cleared after Clear local data" });

  // Record pressed while the camera is still starting waits for it, rather
  // than reporting that the camera is off.
  await h.open();
  await h.click("Start signing");
  await h.click("Start camera & record");
  await until(() => h.evaluate("!!document.querySelector('.calibration-capture.countdown, .calibration-capture.recording')"),
    "Recording did not start after the camera finished starting");
  assert.ok(!(await h.evaluate("document.body.textContent.includes('Start the camera before recording')")), "Record during camera start-up reported the camera as off");
  checks.push({ check: "record pressed during camera start-up waits for the camera" });

  // No page may scroll sideways on a small phone (WCAG 2.2 1.4.10 reflow).
  const wide = [];
  for (const width of [320, 375, 390, 820]) {
    await h.browser.send("Emulation.setDeviceMetricsOverride", { width, height: 800, deviceScaleFactor: 2, mobile: true });
    for (const path of ["/", "/languages", "/models", "/privacy", "/about", "/how-it-works", "/roadmap", "/terms"]) {
      await h.browser.send("Page.navigate", { url: `${h.origin}${path}` });
      await until(() => h.evaluate("document.readyState === 'complete'"), `${path} did not load`);
      await pause(300);
      const { scroll, viewport } = await h.evaluate("({ scroll: document.documentElement.scrollWidth, viewport: window.visualViewport.width })");
      if (scroll > viewport + 1) wide.push(`${path} at ${width} px is ${scroll} px wide`);
    }
  }
  // 200% text size (WCAG 1.4.4) at 390 px.
  for (const path of ["/", "/languages", "/models", "/privacy", "/about", "/how-it-works", "/roadmap", "/terms"]) {
    await h.browser.send("Page.navigate", { url: `${h.origin}${path}` });
    await until(() => h.evaluate("document.readyState === 'complete'"), `${path} did not load`);
    await h.evaluate("document.documentElement.style.fontSize = '200%'");
    await pause(300);
    const { scroll, viewport } = await h.evaluate("({ scroll: document.documentElement.scrollWidth, viewport: window.visualViewport.width })");
    if (scroll > viewport + 1) wide.push(`${path} at 390 px with 200% text is ${scroll} px wide`);
  }
  // A 48-character custom word without spaces must wrap inside its card and message.
  await h.open();
  await h.start();
  await h.evaluate(`(() => { const input = document.querySelector('[aria-label="Word or short phrase to teach"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Pneumonoultramicroscopicsilicovolcanoconiosisxyz');
    input.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('#personal-vocabulary').open = true; })()`);
  await h.click("Select word");
  await pause(300);
  const spilled = await h.evaluate("[...document.querySelectorAll('.selected-word-card strong, .calibration-message')].filter(e => e.scrollWidth > e.clientWidth + 2).map(e => e.className || e.tagName)");
  if (spilled.length) wide.push(`long custom word spills out of ${spilled.join(", ")}`);
  await h.browser.send("Emulation.clearDeviceMetricsOverride");
  assert.deepEqual(wide, [], "Pages wider than a phone screen");
  checks.push({ check: "no horizontal scrolling on 8 pages at 320, 375, 390 and 820 px, at 200% text, and with a 48-character word" });
  console.log(JSON.stringify({ passed: true, checks, environment: "headless Chromium, rehearsal build with synthetic landmarks; not an assistive-technology user test" }));
} finally { await h.close(); }
