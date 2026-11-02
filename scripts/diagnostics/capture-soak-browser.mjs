// Capture-lifecycle soak on the real rehearsal export (npm run build:rehearsal)
// with a synthetic fake-camera pattern (no person, no landmarks). Watches for
// VideoFrame/ImageBitmap handles that are garbage-collected unclosed (Chrome
// logs these; unclosed camera frames can exhaust the capture pool and stall
// the camera), and samples JS heap after forced GC. Headless Chromium only:
// not GPU, WASM-arena, mobile or physical-device memory evidence.
//
// usage: node scripts/diagnostics/capture-soak-browser.mjs <chrome> <words|words-capture|fingerspelling> <seconds> <out.json> [restarts] [captures]
// captures=1 (fingerspelling) repeats Start/Finish captures between samples, exercising
// the drain, VideoFrame snapshot, diagnostics and quality-rejection paths.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { openRehearsal, until, pause } from "../../tests/rehearsal-harness.mjs";
import { writeIdentityY4m } from "./frame-identity.mjs";

const [chrome, mode = "fingerspelling", secondsArg = "60", out = "work/capture-soak.json", restartsArg = "0"] = process.argv.slice(2);
const seconds = Number(secondsArg), restarts = Number(restartsArg), captures = process.argv[7] === "1";
const video = resolve(tmpdir(), "signrelay-soak-30.y4m");
writeIdentityY4m(video, { fps: 30, frames: 900 });
const h = await openRehearsal(chrome, { extraArgs: [`--use-file-for-fake-video-capture=${video}`, "--js-flags=--expose-gc"] });
const warnings = [];
h.browser.onEvent(message => {
  const text = message.method === "Runtime.consoleAPICalled" ? message.params.args.map(a => a.value ?? a.description ?? "").join(" ")
    : message.method === "Log.entryAdded" ? message.params.entry.text : null;
  if (text && /garbage collected|without (being|having been) closed|VideoFrame|ImageBitmap/i.test(text)) warnings.push(text.slice(0, 300));
});
try {
  await h.browser.send("Runtime.enable"); await h.browser.send("Log.enable");
  await h.open(mode === "words-capture" ? "/?perf&captureClock=capture" : "/?perf");
  await h.start();
  if (mode === "fingerspelling") await h.click("Fingerspelling");
  await until(() => h.evaluate(`document.querySelector('.status-badge')?.textContent === 'Active'`), "Camera inactive");
  await pause(3000);
  const heap = async () => { await h.browser.send("HeapProfiler.collectGarbage"); return h.evaluate("performance.memory.usedJSHeapSize"); };
  const samples = [{ at: 0, heap: await heap() }];
  const started = Date.now();
  let restarted = 0, cycles = 0;
  while (Date.now() - started < seconds * 1000) {
    await pause(Math.min(10000, seconds * 1000 / 6));
    // Optional mode switches exercise capture teardown and re-creation.
    if (restarted < restarts) {
      const target = await h.evaluate(`document.querySelector('.asl-mode-selector button[aria-pressed="true"]')?.textContent.trim() === 'Fingerspelling' ? 'Word Recognition' : 'Fingerspelling'`);
      await h.click(target); restarted++;
      await until(() => h.evaluate(`document.querySelector('.status-badge')?.textContent === 'Active'`), "Camera inactive after switch");
    }
    if (captures) {
      const pressed = await h.evaluate(`document.querySelector('.asl-mode-selector button[aria-pressed="true"]')?.textContent.trim()`);
      for (let i = 0; pressed === "Fingerspelling" && i < 3; i++) {
        await until(() => h.has("Capture name"), "Capture control missing");
        await until(() => h.evaluate(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Capture name' && !b.disabled)`), "Capture control disabled");
        await h.click("Capture name"); await pause(1500); await h.click("Finish capture");
        await until(() => h.evaluate(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Capture name' && !b.disabled)`), "Capture did not return to ready");
        cycles++;
      }
    }
    samples.push({ at: Math.round((Date.now() - started) / 1000), heap: await heap() });
  }
  const summary = { kind: "headless Chromium capture-lifecycle soak with synthetic fake camera; not GPU/WASM/mobile/physical-device memory evidence",
    mode, seconds, modeSwitches: restarted, captureCycles: cycles, userAgent: await h.evaluate("navigator.userAgent"),
    unclosedHandleWarnings: warnings.length, warningExamples: warnings.slice(0, 5),
    heapMB: samples.map(s => ({ at: s.at, mb: Math.round(s.heap / 1e4) / 100 })),
    stillActive: await h.evaluate(`document.querySelector('.status-badge')?.textContent === 'Active'`) };
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(summary, null, 1));
  console.log("CAPTURE-SOAK", JSON.stringify(summary));
} finally { await h.close(); }
