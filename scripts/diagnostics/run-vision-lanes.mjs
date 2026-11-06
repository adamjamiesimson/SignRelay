// Runner-local licensed PNGs. The report contains timings and counts only.
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { cpus, platform } from "node:os";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, resolve, sep } from "node:path";
import { build } from "esbuild";
import { startChrome } from "./chrome-session.mjs";

const [chrome, output, roundsArg = "2", clipLimitArg] = process.argv.slice(2);
if (!chrome || !output) throw new Error("Usage: node scripts/diagnostics/run-vision-lanes.mjs CHROME REPORT [ROUNDS] [CLIP_LIMIT]");
const baseline = "6fad3a4a1fa80e24d6caafbead4668ce2f3fb323";
const root = resolve("work/determinism"), assets = resolve("public/vision");
const samples = JSON.parse(await readFile(resolve(root, "samples.json"), "utf8")).slice(0, clipLimitArg ? Number(clipLimitArg) : undefined);
const rounds = Number(roundsArg);
if (!samples.length || !Number.isInteger(rounds) || rounds < 1) throw new Error("Expected at least one clip and one round");
const [page, split] = await Promise.all([
  build({ entryPoints: ["scripts/diagnostics/vision-lanes-browser.ts"], bundle: true, write: false, format: "esm" }),
  build({ entryPoints: ["scripts/diagnostics/vision-split.worker.ts"], bundle: true, write: false, format: "iife" }),
]);
const combined = execFileSync("git", ["show", `${baseline}:public/workers/vision.worker.js`], { maxBuffer: 4 * 1024 * 1024 });
const bundles = new Map([["/page.js", page.outputFiles[0].contents], ["/split.worker.js", split.outputFiles[0].contents], ["/combined.worker.js", combined]]);
const server = createServer(async (request, response) => {
  const url = new URL(request.url, "http://localhost").pathname;
  if (url === "/") return response.writeHead(200, { "Content-Type": "text/html" }).end('<script type="module" src="/page.js"></script>');
  if (bundles.has(url)) return response.writeHead(200, { "Content-Type": "text/javascript" }).end(bundles.get(url));
  const base = url.startsWith("/frames/") ? root : url.startsWith("/vision/") ? assets : null;
  if (!base) return response.writeHead(404).end();
  const file = resolve(base, `.${url.startsWith("/vision/") ? url.slice(7) : url}`);
  if (!file.startsWith(base + sep)) return response.writeHead(403).end();
  const types = { ".js": "text/javascript", ".wasm": "application/wasm", ".png": "image/png" };
  try { const bytes = await readFile(file); response.writeHead(200, { "Content-Type": types[extname(file)] ?? "application/octet-stream" }).end(bytes); }
  catch { response.writeHead(404).end(); }
});
await mkdir(dirname(output), { recursive: true });
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await startChrome(chrome, { proxy: "http://127.0.0.1:9" });
  await browser.send("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/` });
  for (let i = 0; i < 100 && !await browser.evaluate('typeof window.replayVisionLanes === "function"'); i++) await new Promise(resolve => setTimeout(resolve, 100));
  const report = { baseline, cpu: cpus()[0]?.model, platform: platform(), browser: await browser.send("Browser.getVersion"), rounds,
    clips: samples.length, delegate: "CPU", input: process.env.SIGNRELAY_RGB_KIND === "synthetic" ? "Synthetic RGB harness check; no signer or accuracy evidence."
      : "Display-timed decoded RGB. FSboard clips are exposed fingerspelling, so any starter output is an unsupported-sign accept. RAF measures a presentation opportunity, excluding physical sensor and display.", rows: [] };
  const fastSlots = new Map();
  for (let round = 0; round < rounds; round++) for (const [index, sample] of samples.entries()) {
    const pair = {};
    if (sample.frames.length > 600) throw new Error("Replay clip exceeds the 600-frame decoded input bound");
    const frames = sample.frames.map(({ ms, png }) => ({ ms, png }));
    const args = JSON.stringify(frames);
    if (!fastSlots.has(index)) fastSlots.set(index, await browser.evaluate(`replayVisionLanes(${args},"reference",${sample.annotationStartMs},${sample.annotationEndMs})`));
    for (const mode of (round + index) % 2 ? ["split", "combined"] : ["combined", "split"]) {
      pair[mode] = await browser.evaluate(`replayVisionLanes(${args},${JSON.stringify(mode)},${sample.annotationStartMs},${sample.annotationEndMs},${JSON.stringify(fastSlots.get(index))})`);
    }
    const combinedCounts = new Map(pair.combined.activeHandCounts);
    const overlap = pair.split.activeHandCounts.filter(([i]) => combinedCounts.has(i));
    const disagreements = overlap.filter(([i, n]) => combinedCounts.get(i) !== n).length;
    delete pair.combined.activeHandCounts; delete pair.split.activeHandCounts;
    report.rows.push({ round: round + 1, clip: index + 1, overlap: overlap.length, disagreements, ...pair });
    await writeFile(output, JSON.stringify(report, null, 2) + "\n");
    console.log("VISION-LANES", round + 1, index + 1, JSON.stringify({ drawP95: [pair.combined.draw.p95, pair.split.draw.p95], delivered: [pair.combined.delivered, pair.split.delivered], overlap: overlap.length, disagreements }));
  }
  const median = values => {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
  };
  const result = Object.fromEntries(["combined", "split"].map(mode => {
    const rows = report.rows.map(pair => pair[mode]);
    const sum = key => rows.reduce((total, row) => total + row[key], 0);
    return [mode, { medianClipDrawP95: median(rows.map(row => row.draw.p95)), medianFastDrawP95: median(rows.map(row => row.fastDraw.p95)),
      medianClipNextRafP95: median(rows.map(row => row.nextRaf.p95)), medianClipResultP95: median(rows.map(row => row.result.p95)),
      medianClipGapP95: median(rows.map(row => row.gaps.p95)), medianStartup: median(rows.map(row => row.startup)),
      delivered: sum("delivered"), dropped: sum("dropped"), fastSlots: sum("fastSlots"), fastDelivered: sum("fastDelivered"), fastNoHands: sum("fastNoHands"),
      losses: sum("losses"), recoveries: sum("recoveries"), twoHands: sum("activeTwoHands"), freezes: sum("freezesOver200Ms"),
      noFreshAux: mode === "split" ? sum("noFreshAux") : null, unsupportedAccepts: rows.filter(row => row.candidate).length }];
  }));
  report.summary = result;
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log("VISION-LANES-SUMMARY", JSON.stringify({ pairs: report.rows.length, ...result }));
} finally {
  try { await browser?.close(); } finally { server.closeAllConnections(); server.close(); }
}
