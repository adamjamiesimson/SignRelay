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
  }).observe(document, { subtree: true, childList: true, characterData: true });` });
const checks = [];
try {
  await h.open();
  await h.start();

  // Rapid words: 250 ms rests (the shortest that keeps all six in synthetic tests).
  await h.evaluate("document.querySelector('.switch-row.prominent input')?.click()");
  await h.play(sequence(["HELLO", "THANK YOU", "PLEASE", "SORRY", "YES", "NO"], 250));
  await until(async () => !(await h.playing()), "Rapid sequence did not finish", 600);
  await pause(1500);
  const words = await h.words();
  assert.deepEqual(words, ["Hello", "Thank you", "Please", "Sorry", "Yes", "No"], "Rapid words in order, no duplicates");
  const announced = await h.evaluate("window.__qa.announcements.filter(a => a.startsWith('Confirmed:'))");
  assert.deepEqual(announced, words.map(word => `Confirmed: ${word}`), "Each confirmed word is announced once in a polite live region");
  assert.deepEqual(await h.evaluate("window.__qa.spoken"), words, "Each word spoken once");
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
  checks.push({ check: "keyboard edit of a transcript entry" });

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
  console.log(JSON.stringify({ passed: true, checks, environment: "headless Chromium, rehearsal build with synthetic landmarks; not an assistive-technology user test" }));
} finally { await h.close(); }
