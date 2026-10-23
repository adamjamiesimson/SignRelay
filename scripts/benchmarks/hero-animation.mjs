// Cost of the homepage hand illustration in headless Chromium, against the
// export in out/: per-frame callback time, long tasks and caption re-renders,
// at desktop size and on a 390 px phone with the CPU throttled 4×, plus proof
// that the illustration is gone (no frames scheduled) in the workspace.
//   node scripts/benchmarks/hero-animation.mjs /path/to/chrome [out.json]
// A headless regression record, not a measurement on a real device.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { startChrome } from "../diagnostics/chrome-session.mjs";
import { RETURNING_VISITOR } from "../../tests/helpers/returning-visitor.mjs";

const [executable, output] = process.argv.slice(2);
if (!executable) throw new Error("Usage: node scripts/benchmarks/hero-animation.mjs <chrome> [out.json]");
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const port = 18640 + Math.floor(Math.random() * 40), origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["scripts/serve-export.mjs", "--host", "127.0.0.1", "--port", String(port)], { stdio: "ignore" });
await pause(1200);

const PROBE = `(() => {
  const raf = window.requestAnimationFrame.bind(window);
  window.__bench = { durations: [], longTasks: 0, captions: 0 };
  window.requestAnimationFrame = callback => raf(time => { const start = performance.now(); try { callback(time); } finally { window.__bench.durations.push(performance.now() - start); } });
  try { new PerformanceObserver(list => { window.__bench.longTasks += list.getEntries().length; }).observe({ type: "longtask", buffered: true }); } catch {}
  addEventListener("DOMContentLoaded", () => {
    const hero = document.querySelector(".hero-preview");
    if (hero) new MutationObserver(() => window.__bench.captions++).observe(hero, { attributes: true, attributeFilter: ["data-phase"] });
  });
})();`;
const quantile = (values, q) => values.length ? [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(q * values.length))] : null;
const round = value => value === null ? null : Math.round(value * 1000) / 1000;

async function measure({ label, width, height, mobile, throttle }) {
  const browser = await startChrome(executable);
  try {
    await browser.send("Page.addScriptToEvaluateOnNewDocument", { source: PROBE });
    await browser.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: mobile ? 3 : 1, mobile });
    if (throttle) await browser.send("Emulation.setCPUThrottlingRate", { rate: throttle });
    await browser.send("Page.navigate", { url: `${origin}/` });
    await pause(3000);
    await browser.evaluate("document.querySelector('.hero-preview').scrollIntoView({ block: 'center' }); window.__bench.durations = []; window.__bench.longTasks = 0; window.__bench.captions = 0; window.__bench.started = performance.now();");
    await pause(10000);
    const bench = await browser.evaluate("({ ...window.__bench, seconds: (performance.now() - window.__bench.started) / 1000 })");
    return { label, viewport: `${width}×${height}`, cpu_throttle: throttle ?? 1, seconds: round(bench.seconds),
      frames_per_second: round(bench.durations.length / bench.seconds),
      frame_callback_ms: { p50: round(quantile(bench.durations, 0.5)), p95: round(quantile(bench.durations, 0.95)), max: round(Math.max(...bench.durations)) },
      long_tasks: bench.longTasks, caption_rerenders_per_second: round(bench.captions / bench.seconds) };
  } finally { await browser.close(); }
}

async function workspace() {
  const browser = await startChrome(executable);
  try {
    await browser.send("Page.addScriptToEvaluateOnNewDocument", { source: RETURNING_VISITOR });
    await browser.send("Page.navigate", { url: `${origin}/` });
    await pause(2500);
    await browser.evaluate("[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Start signing').click()");
    await pause(1500);
    return { hero_mounted_in_workspace: await browser.evaluate("!!document.querySelector('.hero-preview')") };
  } finally { await browser.close(); }
}

try {
  const report = {
    generated_at: new Date().toISOString(),
    environment: "headless Chromium, static export, synthetic run; not a real device",
    runs: [
      await measure({ label: "desktop", width: 1440, height: 900, mobile: false }),
      await measure({ label: "phone, CPU ×4 slower", width: 390, height: 844, mobile: true, throttle: 4 }),
    ],
    ...(await workspace()),
  };
  console.log(JSON.stringify(report, null, 2));
  if (output) writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
} finally { server.kill(); }
