// AUTOMATED SOFTWARE REHEARSAL of the GITEX demo script on the rehearsal export
// (npm run build:rehearsal). Synthetic hand landmarks replace the tracker's
// output (the tracker is not run while a script plays) while the real
// fake-camera stream, frame loop, recognition worker,
// transcript, Copy and speech controls run. It proves the software path of the
// script works offline; it is not a person signing and not an accuracy test.
//   node tests/gitex-rehearsal-smoke.mjs /path/to/chrome
import assert from "node:assert/strict";
import { fixtures, openRehearsal, pause, until } from "./rehearsal-harness.mjs";

const executable = process.argv[2];
if (!executable) throw new Error("Usage: node tests/gitex-rehearsal-smoke.mjs <chrome>");
const SIX = ["HELLO", "THANK YOU", "PLEASE", "SORRY", "YES", "NO"];
const TEXT = ["Hello", "Thank you", "Please", "Sorry", "Yes", "No"];
const { sequence, negative } = await fixtures();
const h = await openRehearsal(executable);
const steps = [];
const step = (name, detail = {}) => steps.push({ step: name, ...detail });
try {
  await h.browser.send("Network.setBlockedURLs", { urls: ["*cdn.jsdelivr.net*", "*storage.googleapis.com*"] });
  await h.open("/?perf");
  const banner = await h.evaluate("document.querySelector('.rehearsal-banner')?.textContent");
  assert.match(banner ?? "", /^AUTOMATED SOFTWARE REHEARSAL/, "Every rehearsal page must carry the rehearsal banner");
  assert.equal(await h.evaluate("[...document.querySelectorAll('[role=radio]')].find(b=>b.textContent.includes('British'))?.disabled"), true, "Only ASL is available");
  step("offline ASL build opened", { profile: h.manifest.profile, worker: h.manifest.recognition_worker_sha256.slice(0, 12) });

  await h.start();
  step("camera started (synthetic fake camera)");

  // Abstention: everyday movements that the rules do not accept produce no word.
  for (const name of ["hands resting at the chest", "scratching the chin", "lifting a fist as if holding a cup"]) {
    await h.play(negative(name));
    await until(async () => !(await h.playing()), `${name} did not finish`);
    await pause(800);
  }
  assert.deepEqual(await h.words(), [], "A non-sign movement produced a word");
  step("abstained on three non-sign movements");

  // The six-sign script with lowered hands between signs.
  await h.evaluate("document.querySelector('.switch-row.prominent input')?.click()"); // Auto speak on
  await h.play(sequence(SIX, 700));
  await until(async () => (await h.words()).length >= 6 || !(await h.playing()), "Sequence did not play", 600);
  await pause(1500);
  assert.deepEqual(await h.words(), TEXT, "Six-sign sequence");
  const editRemoveControls = await h.evaluate("document.querySelectorAll('.transcript-entry .entry-actions button[aria-label]').length");
  assert.equal(editRemoveControls, TEXT.length * 2, "Each confirmed word offers edit and remove controls");
  assert.deepEqual(await h.evaluate("window.__qa.spoken"), TEXT, "Auto speak spoke each confirmed word once");
  step("six-sign sequence confirmed in order", { words: TEXT });

  // Copy and speech controls.
  await h.browser.send("Browser.grantPermissions", { origin: h.origin, permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"] }).catch(() => {});
  await h.click("Copy");
  await pause(300);
  const copied = await h.evaluate("navigator.clipboard.readText().catch(() => null)");
  const fallback = await h.evaluate("document.body.textContent.includes('Copying is not available here')");
  assert.ok(copied?.includes("Hello") || fallback, "Copy must either copy the transcript or explain how to copy");
  await h.click("Speak");
  assert.equal((await h.evaluate("window.__qa.spoken")).at(-1), TEXT.join(" "));
  const cancels = await h.evaluate("window.__qa.cancels");
  await h.click("Stop");
  assert.ok(await h.evaluate("window.__qa.cancels") > cancels, "Stop cancels speech");
  step("Copy and Speak/Stop", { copy: copied ? "clipboard" : "fallback message shown" });

  // Camera interruption and recovery.
  await h.evaluate("window.__qa.tracks.filter(t => t.readyState === 'live').forEach(t => t.stop())");
  await until(() => h.evaluate("/The camera stopped sending video|The camera was disconnected/.test(document.body.textContent)"), "Camera interruption was not reported", 150);
  await h.click((await h.has("Retry camera")) ? "Retry camera" : "Start camera");
  await until(h.active, "Camera did not recover");
  await pause(2700); // past the repeated-word cooldown
  await h.play(sequence(["HELLO"], 700));
  await until(async () => (await h.words()).length === 7, "No word after camera recovery", 300);
  assert.equal((await h.words()).at(-1), "Hello");
  step("camera interruption reported and recovered", { word_after_recovery: "Hello" });

  // No inaccurate claims on the workspace, and nothing left the machine.
  const body = await h.evaluate("document.body.innerText");
  assert.match(body, /research preview/i, "The experimental recognition limitation remains visible");
  for (const claim of [/\b\d{1,3}(\.\d+)?\s?% (accura|correct)/i, /accurately translates/i, /understands (all|any) sign/i, /real-world accuracy of/i])
    assert.doesNotMatch(body, claim, `Inaccurate claim on the page: ${claim}`);
  assert.deepEqual(h.nonLoopback(), [], "Non-loopback requests");
  step("no inaccurate claims; no non-loopback requests");
  await h.click("Pause camera");
  await until(() => h.evaluate("window.__qa.tracks.every(t => t.readyState === 'ended')"), "Camera not released");
  console.log(JSON.stringify({ passed: true, kind: "AUTOMATED SOFTWARE REHEARSAL (synthetic landmarks; not a person signing; not accuracy)", steps,
    manual_gates: "the five physical-camera manual gates remain pending" }));
} finally { await h.close(); }
