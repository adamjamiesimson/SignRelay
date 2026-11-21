// Feed a Y4M reel to the lab through Chrome's fake camera (the real getUserMedia + camera
// path, segmentation and worker), record every recognition event with its time, and write
// them for scoring against the reel's ground-truth intervals.
//   node chrome-camera-replay.mjs <origin> <reel.y4m> <truth.json> <out.json>
import { chromium } from "playwright";
import { readFile, writeFile } from "node:fs/promises";
const [origin, reel, truthPath, out] = process.argv.slice(2);
const truth = JSON.parse(await readFile(truthPath, "utf8"));
const browser = await chromium.launch({ args: ["--no-sandbox", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
  `--use-file-for-fake-video-capture=${reel}`] });
const page = await browser.newPage();
// Optional slower-device emulation (DevTools CPU throttling; applies to the page renderer).
if (process.env.CPU_THROTTLE) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: Number(process.env.CPU_THROTTLE) });
}
await page.goto(`${origin}/${process.env.V3_QUERY ?? "?debug"}`);
await page.waitForSelector("body[data-ready]", { state: "attached", timeout: 180000 });
await page.evaluate(() => { window.__t0 = null; const v = document.querySelector("#cam");
  v.addEventListener("playing", () => { window.__t0 = performance.now(); }, { once: true }); });
await page.click("#startcam");
await page.waitForFunction(() => window.__t0 !== null, null, { timeout: 60000 });
const wallStart = Date.now();
await page.waitForTimeout(truth.duration * 1000 + 1500);
const res = await page.evaluate(() => ({ camera_t0: window.__t0, samples: window.__camSamples ?? [], events: window.__v3.state.events, stats: window.__v3.state.stats, diag: document.querySelector("#diag").textContent }));
await page.click("#stopcam");
await writeFile(out, JSON.stringify({ reel, truth, wallMs: Date.now() - wallStart, ...res }, null, 1));
console.log(res.diag); console.log(res.events.map(e => `${e.t.slice(11, 19)} ${e.status} ${e.label ?? e.best}`).join("\n"));
await browser.close();
