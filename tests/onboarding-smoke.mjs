// First-visit tour, navigation, cookie choices and the homepage illustration
// on the rehearsal export (npm run build:rehearsal), as a first-time visitor.
//   node tests/onboarding-smoke.mjs /path/to/chrome [node_modules/axe-core/axe.min.js]
// Software behaviour in headless Chromium; not a screen-reader user test.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { openRehearsal, pause, until } from "./rehearsal-harness.mjs";

const executable = process.argv[2];
if (!executable) throw new Error("Usage: node tests/onboarding-smoke.mjs <chrome> [axe.min.js]");
const axe = process.argv[3] ? readFileSync(process.argv[3], "utf8") : null;
const h = await openRehearsal(executable, { returning: false, extraInit: `
  window.__qa.cameraRequests = 0;
  const counted = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = options => { window.__qa.cameraRequests++; return counted(options); };` });
const checks = [];
const key = async (name, code, keyCode) => {
  await h.browser.send("Input.dispatchKeyEvent", { type: "keyDown", key: name, code, windowsVirtualKeyCode: keyCode });
  await h.browser.send("Input.dispatchKeyEvent", { type: "keyUp", key: name, code, windowsVirtualKeyCode: keyCode });
};
const tourOpen = () => h.evaluate("!!document.querySelector('dialog.tour')?.open");
const tourTitle = () => h.evaluate("document.querySelector('#tour-title')?.textContent");
const stored = () => h.evaluate("JSON.parse(localStorage.getItem('signrelay.onboarding.v1') || 'null')?.status ?? null");
const cameraRequests = () => h.evaluate("window.__qa.cameraRequests");
const byLabel = label => `document.querySelector('[aria-label=${JSON.stringify(label)}]')`;
const press = label => h.evaluate(`${byLabel(label)}.click()`);
const boneShape = () => h.evaluate("document.querySelector('.hero-hand.dominant .bones')?.getAttribute('d')");
const violations = async label => {
  if (!axe) return [];
  await h.evaluate(axe);
  const found = await h.evaluate(`axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] } }).then(r => r.violations.map(v => v.id + ": " + v.nodes.map(n => n.target.join(" ")).slice(0, 3).join(", ")))`);
  return found.map(item => `${label} · ${item}`);
};
const axeFindings = [];
try {
  // 1. Homepage illustration: labelled, animated by default, paused off screen.
  await h.open();
  assert.match(await h.evaluate("document.querySelector('.hero-label')?.textContent"), /^Illustration · Not live$/);
  assert.ok(!(await h.evaluate("/face|shoulder/i.test(document.querySelector('.hero-preview').textContent)")), "The illustration mentions face or body tracking");
  // At narrow widths the illustration sits below the fold and only runs once it is in view.
  const showHero = () => h.evaluate("document.querySelector('.hero-preview').scrollIntoView({ block: 'center' })");
  await showHero(); await pause(300);
  const before = await boneShape(); await pause(500);
  assert.notEqual(await boneShape(), before, "The hand illustration does not move by default");
  await h.evaluate("window.scrollTo(0, document.body.scrollHeight)"); await pause(400);
  const offscreen = await boneShape(); await pause(600);
  assert.equal(await boneShape(), offscreen, "The illustration keeps animating while off screen");
  await showHero(); await pause(400);
  await press("Pause animation");
  const paused = await boneShape(); await pause(500);
  assert.equal(await boneShape(), paused, "Pause animation did not stop the illustration");
  await press("Play animation"); await pause(400);
  assert.notEqual(await boneShape(), paused, "Play animation did not resume");
  checks.push({ check: "hero illustration is labelled, animates, pauses off screen and on request" });

  // 2. Reduced motion: a still picture until the visitor asks for motion.
  await h.browser.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await h.open(); await showHero(); await pause(300);
  const still = await boneShape(); await pause(700);
  assert.equal(await boneShape(), still, "The illustration moves although reduced motion is requested");
  assert.ok(await h.evaluate(`!!${byLabel("Play animation")}`), "Reduced motion offers no way to play the illustration");
  assert.equal(await h.evaluate("document.getAnimations().filter(a => a.playState === 'running').length"), 0, "CSS animations run under reduced motion");
  await press("Play animation"); await pause(400);
  assert.notEqual(await boneShape(), still, "Play animation does not override reduced motion on request");
  await h.browser.send("Emulation.setEmulatedMedia", { features: [] });
  checks.push({ check: "reduced motion shows a still illustration, with an explicit play control" });

  // 3. Language picker: search narrows the list and says when nothing matches.
  await h.open();
  const search = value => h.evaluate(`(() => { const input = document.querySelector('.language-picker input[type=search]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await search("brit");
  await until(() => h.evaluate("document.querySelectorAll('.language-row [role=radio]').length === 1"), "Search did not narrow the automatic languages");
  assert.match(await h.evaluate("document.querySelector('.language-row [role=radio]').textContent"), /British/);
  await search("zzzz");
  await until(() => h.evaluate("document.querySelector('.language-picker .empty-state')?.textContent.includes('zzzz')"), "No empty state for an unmatched search");
  await search("");
  assert.equal(await h.evaluate("document.querySelectorAll('.language-row [role=radio]').length"), 7);
  assert.equal(await h.evaluate("[...document.querySelectorAll('.language-row [role=radio]')].filter(r => r.tabIndex === 0).length"), 1, "The radio group needs exactly one tab stop");
  checks.push({ check: "language search narrows, reports no match and restores seven automatic languages" });

  // 4. No analytics configured: no banner; Cookie choices explains that.
  assert.equal(await h.evaluate("!!document.querySelector('.consent-banner')"), false, "A consent banner appears although no optional analytics exists");
  await h.click("Cookie choices");
  await until(() => h.evaluate("document.querySelector('dialog.privacy-modal')?.open && /no analytics/.test(document.querySelector('dialog.privacy-modal').textContent)"), "Cookie choices did not explain the absence of analytics");
  axeFindings.push(...await violations("cookie choices"));
  await key("Escape", "Escape", 27);
  await until(async () => !(await h.evaluate("document.querySelector('dialog.privacy-modal')?.open")), "Escape did not close Cookie choices");
  checks.push({ check: "no consent banner without optional analytics; Cookie choices dialog opens and closes" });

  // 5. Mobile navigation: the menu opens, closes with Escape and returns focus.
  await h.browser.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await pause(300);
  assert.ok(await h.evaluate("getComputedStyle(document.querySelector('.site-nav')).display === 'none' && getComputedStyle(document.querySelector('.menu-toggle')).display !== 'none'"), "The phone layout does not switch to a menu");
  await h.evaluate("document.querySelector('.menu-toggle').click()");
  await until(() => h.evaluate("!document.querySelector('#site-menu').hidden && document.querySelector('.menu-toggle').getAttribute('aria-expanded') === 'true'"), "Menu did not open");
  assert.deepEqual(await h.evaluate("[...document.querySelectorAll('#site-menu a')].map(a => a.textContent)"), ["Translator", "Languages", "How it works", "Privacy"]);
  await key("Escape", "Escape", 27);
  await until(() => h.evaluate("document.querySelector('#site-menu').hidden && document.activeElement === document.querySelector('.menu-toggle')"), "Escape did not close the menu and return focus");
  await h.browser.send("Emulation.clearDeviceMetricsOverride");
  checks.push({ check: "phone menu opens, lists the primary links, closes with Escape and returns focus" });

  // 6. First visit: the tour opens instead of the camera.
  await h.open();
  await h.click("Start signing");
  await until(tourOpen, "The tour did not open on the first visit");
  assert.equal(await tourTitle(), "Choose your language");
  assert.equal(await h.evaluate("document.activeElement?.id"), "tour-title", "The tour heading did not take focus");
  assert.equal(await cameraRequests(), 0, "The camera was requested behind the tour");
  await pause(700);
  const aligned = await h.evaluate(`(() => { const t = document.querySelector('[data-tour=language]').getBoundingClientRect(), s = document.querySelector('.tour-spotlight').getBoundingClientRect();
    return Math.abs(t.left - s.left - 8) < 3 && Math.abs(t.top - s.top - 8) < 3; })()`);
  assert.ok(aligned, "The highlight is not over the language switcher");
  axeFindings.push(...await violations("tour step 1"));
  await key("ArrowRight", "ArrowRight", 39);
  await until(async () => (await tourTitle()) === "Start signing", "ArrowRight did not advance");
  await h.click("Back");
  await until(async () => (await tourTitle()) === "Choose your language", "Back did not return");
  for (const title of ["Start signing", "Your words, your way", "Teach SignRelay"]) {
    await h.click("Next");
    await until(async () => (await tourTitle()) === title, `Next did not reach ${title}`);
  }
  assert.equal(await h.has("Skip tour"), false, "The last step still offers Skip");
  await h.click("Finish");
  await until(async () => !(await tourOpen()), "Finish did not close the tour");
  assert.equal(await stored(), "completed");
  await until(() => h.evaluate("document.activeElement?.textContent === 'Start camera'"), "Focus did not move to Start camera after the tour");
  assert.equal(await cameraRequests(), 0, "Finishing the tour started the camera");
  checks.push({ check: "first visit: four steps with Back/Next/Finish and arrow keys, highlight on the real control, no camera" });

  // 7. Replay from the workspace; Escape dismisses.
  await h.click("Take a tour");
  await until(async () => (await tourOpen()) && (await tourTitle()) === "Choose your language", "Take a tour did not reopen at step 1");
  await key("Escape", "Escape", 27);
  await until(async () => !(await tourOpen()), "Escape did not close the tour");
  assert.equal(await stored(), "dismissed");
  checks.push({ check: "Take a tour replays from step 1; Escape dismisses and is remembered" });

  // 8. Returning visitor: no tour, the camera starts as before.
  await h.open();
  await h.click("Start signing");
  await until(h.active, "The camera did not start for a returning visitor");
  assert.equal(await tourOpen(), false, "The tour reappeared for a returning visitor");
  checks.push({ check: "a returning visitor goes straight to the camera" });

  // 9. Clear local data resets the tour.
  await h.click("Pause camera");
  await h.click("Clear local data");
  await until(async () => (await stored()) === null, "Clear local data kept the tour record");
  await h.open();
  await h.click("Start signing");
  await until(tourOpen, "The tour did not return after Clear local data");
  await h.click("Skip tour");
  await until(async () => (await stored()) === "dismissed", "Skip tour was not remembered");
  checks.push({ check: "Clear local data resets the tour; Skip is remembered" });

  // 10. Links into the translator: #tour replays, ?lang opens a workspace; neither starts the camera.
  const requests = await cameraRequests();
  await h.browser.send("Page.navigate", { url: `${h.origin}/#tour` });
  await until(tourOpen, "/#tour did not open the tour");
  await h.click("Skip tour");
  await h.browser.send("Page.navigate", { url: `${h.origin}/?lang=asl#translator` });
  await until(() => h.evaluate("document.querySelector('select[aria-label=\"Change sign language\"]')?.value === 'asl'"), "?lang did not open the workspace");
  assert.equal(await h.evaluate("location.hash + location.search"), "", "The entry link was not tidied from the address");
  assert.equal(await tourOpen(), false);
  assert.equal(await cameraRequests(), requests, "A link into the translator started the camera");
  checks.push({ check: "/#tour and ?lang links open the workspace without starting the camera" });

  assert.deepEqual(axeFindings, [], "axe-core WCAG A/AA violations");
  if (axe) checks.push({ check: "axe-core: no WCAG A/AA violations with the tour and the Cookie choices dialog open" });
  console.log(JSON.stringify({ passed: true, checks, environment: "headless Chromium, rehearsal build, first-time visitor; not an assistive-technology user test" }));
} finally { await h.close(); }
