// Run video files through the built lab in headless Chrome (real <video> decode, real
// MediaPipe WASM, real ONNX Runtime Web) and write per-clip landmarks + results as JSON.
//   node chrome-file-run.mjs <origin> <out.json> <video...>
import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";
const [origin, out, ...videos] = process.argv.slice(2);
const browser = await chromium.launch({ args: ["--no-sandbox", "--enable-features=SharedArrayBuffer"] });
const page = await browser.newPage();
const logs = []; page.on("console", m => logs.push(m.text())); page.on("pageerror", e => logs.push("PAGEERROR " + e.message));
const t0 = Date.now();
await page.goto(`${origin}/?debug`);
await page.waitForSelector("body[data-ready]", { state: "attached", timeout: 180000 }).catch(async e => { console.error(await page.textContent("#status"), logs); throw e; });
const startupMs = Date.now() - t0;
const version = await page.textContent("#version");
const results = [];
for (const v of videos) {
  await page.evaluate(() => { window.__lastFileResult = null; });
  const s = Date.now();
  await page.setInputFiles("#file", v);
  await page.waitForFunction(() => window.__lastFileResult, null, { timeout: 300000 });
  const r = await page.evaluate(() => ({ result: window.__lastFileResult, frames: window.__lastFileFrames }));
  r.video = v; r.wallMs = Date.now() - s; results.push(r);
  console.log(v.split("/").pop(), r.result.status, r.result.label ?? r.result.best, `${r.result.frameCount} frames, hands ${r.result.handFrameCount}, ${r.wallMs} ms`);
}
await writeFile(out, JSON.stringify({ startupMs, version, userAgent: await page.evaluate(() => navigator.userAgent),
  crossOriginIsolated: await page.evaluate(() => self.crossOriginIsolated), results, logs }));
await browser.close();
