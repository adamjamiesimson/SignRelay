// End-to-end verification of a deployed (or locally served) V3 lab in real headless Chrome.
//   node verify-deployment.mjs <origin> <smoke-set.json> <reel.y4m> <out.json> [unknown-clip ...]
// smoke-set.json: [{ video, truth, status, label, best, top5 }] - reference results from an earlier
// validated Chrome run of the same model (used to detect any change in recognition outputs).
// Checks: every request status, same-origin only (nothing leaves the page), console/page errors,
// model + asset SHA-256 against meta.json, 523 classes, vocabulary search, video recognition under both
// policies, unknown-sign handling, camera start/stop/restart through getUserMedia (Chrome fake camera),
// permission denial message, desktop/mobile layout.
import { chromium } from "playwright";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const [origin, smokePath, reel, out, ...unknownClips] = process.argv.slice(2);
const smoke = JSON.parse(await readFile(smokePath, "utf8"));
const EXPECT_SHA = process.env.EXPECT_SHA ?? "b3e05424f4674d8235ac8bc51970cef6822e12ac629c4a02bca596bc7f5d3090";
const report = { origin, started: new Date().toISOString(), checks: {}, smoke: [], unknown: [], camera: {}, perf: {} };
const check = (name, ok, detail) => { report.checks[name] = { ok: !!ok, detail }; console.log(ok ? "PASS" : "FAIL", name, detail ?? ""); };
const sha = b => createHash("sha256").update(b).digest("hex");
const host = new URL(origin).host;
// Behind this container's egress proxy (https origins only): Chrome uses the proxy and trusts its CA (NSS db).
const viaProxy = origin.startsWith("https:") && process.env.HTTPS_PROXY;
const launch = (opts = {}) => chromium.launch({ ...opts, ...(viaProxy ? { proxy: { server: process.env.HTTPS_PROXY } } : {}) });

function watch(page, sink) {
  page.on("console", m => { if (m.type() === "error") sink.consoleErrors.push(m.text()); });
  page.on("pageerror", e => sink.pageErrors.push(e.message));
  page.on("response", r => { sink.responses.push({ url: r.url(), status: r.status() }); });
  page.on("request", r => { const u = new URL(r.url()); if (!["data:", "blob:"].includes(u.protocol) && u.host !== host) sink.foreign.push(r.url()); });
  page.on("requestfailed", r => sink.failed.push(`${r.url()} ${r.failure()?.errorText}`));
}
const sinkNew = () => ({ consoleErrors: [], pageErrors: [], responses: [], foreign: [], failed: [] });

// ---------------------------------------------------------------- 1. load, identity, assets
const browser = await launch({ args: ["--no-sandbox", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
  `--use-file-for-fake-video-capture=${reel}`] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage(); const sink = sinkNew(); watch(page, sink);
const t0 = Date.now();
const nav = await page.goto(`${origin}/?debug`);
check("page loads (HTTP 200)", nav.status() === 200, nav.status());
await page.waitForSelector("body[data-ready]", { state: "attached", timeout: 240000 });
report.perf.startupWallMs = Date.now() - t0;
const ui = await page.evaluate(() => ({ version: document.querySelector("#version").textContent, startup: document.querySelector("#startup").textContent,
  title: document.title, h1: document.querySelector("h1").textContent, nclasses: document.querySelector("#nclasses").textContent,
  secure: isSecureContext, coi: self.crossOriginIsolated, meta: { version: window.__v3.state.meta.version, sha: window.__v3.state.meta.model_sha256,
    commit: window.__v3.state.meta.commit, classes: window.__v3.state.meta.classes.length, unknown_index: window.__v3.state.meta.unknown_index,
    policies: Object.keys(window.__v3.state.meta.policies ?? {}), assets: window.__v3.state.meta.assets } }));
report.identity = ui; report.perf.startupLabel = ui.startup;
check("model version is v3.1", ui.meta.version === "v3.1" && ui.h1.includes("V3.1"), ui.version);
check("523 classes + UNKNOWN index 523", ui.meta.classes === 523 && ui.meta.unknown_index === 523 && ui.nclasses === "523", ui.nclasses);
check("expected V3.1 model fingerprint in meta.json", ui.meta.sha === EXPECT_SHA, ui.meta.sha);
check("both policies shipped", ui.meta.policies.includes("balanced") && ui.meta.policies.includes("strict"), ui.meta.policies.join("+"));
check("secure context + cross-origin isolated", ui.secure && ui.coi, `secure=${ui.secure} coi=${ui.coi}`);
// Fetch the served bytes and verify fingerprints independently of the page.
const get = async p => { const r = await fetch(new URL(p, origin + "/")); return { status: r.status, headers: r.headers, buf: Buffer.from(await r.arrayBuffer()) }; };
const model = await get("model.onnx");
check("served model.onnx SHA-256 = V3.1 fingerprint", model.status === 200 && sha(model.buf) === EXPECT_SHA, `${model.status} ${sha(model.buf).slice(0, 16)} ${model.buf.length} B`);
for (const [f, digest] of Object.entries(ui.meta.assets)) {
  const a = await get(`vision/models/${f}`); check(`asset ${f} SHA-256`, a.status === 200 && sha(a.buf) === digest, a.status);
}
const idx = await get("");
report.headers = Object.fromEntries(["cross-origin-opener-policy", "cross-origin-embedder-policy", "content-security-policy", "permissions-policy", "strict-transport-security"].map(h => [h, idx.headers.get(h)]));
check("COOP/COEP/CSP headers", report.headers["cross-origin-opener-policy"] === "same-origin" && report.headers["cross-origin-embedder-policy"] === "require-corp" &&
  /connect-src 'self'/.test(report.headers["content-security-policy"] ?? ""), JSON.stringify(report.headers).slice(0, 200));
// vocabulary browser
const voc = await page.evaluate(() => { const s = document.querySelector("#vocabsearch"); s.value = "APP"; s.dispatchEvent(new Event("input"));
  const r = { count: document.querySelector("#vocabcount").textContent, list: document.querySelector("#vocablist").textContent };
  s.value = ""; s.dispatchEvent(new Event("input")); r.all = document.querySelector("#vocablist").textContent.split(" · ").length; return r; });
check("vocabulary browser lists 523 and searches", voc.all === 523 && /APPLE/.test(voc.list), `${voc.all} listed; search APP → ${voc.count}: ${voc.list}`);

// ---------------------------------------------------------------- 2. video recognition, both policies
async function runVideo(v) {
  await page.evaluate(() => { window.__lastFileResult = null; window.__lastFileError = null; });
  const s = Date.now(); await page.setInputFiles("#file", v);
  await page.waitForFunction(() => window.__lastFileResult || window.__lastFileError, null, { timeout: 600000 });
  const r = await page.evaluate(() => ({ res: window.__lastFileResult, err: window.__lastFileError, shown: document.querySelector("#proposal").textContent,
    top5: [...document.querySelectorAll("#top5 li")].map(li => li.textContent) }));
  return { ...r, wallMs: Date.now() - s };
}
const setPolicy = p => page.check(`input[name=policy][value=${p}]`);
await setPolicy("balanced");
let same = 0;
for (const c of smoke) {
  const r = await runVideo(c.video);
  const row = { clip: c.video.split("/").pop(), truth: c.truth, ref: { status: c.status, label: c.label, best: c.best },
    deployed: r.err ? { error: r.err } : { status: r.res.status, label: r.res.label, best: r.res.best, policy: r.res.policy, top5: r.res.top5?.map(t => `${t.label} ${(t.p * 100).toFixed(1)}%`),
      shown: r.shown, frames: r.res.frameCount, handFrames: r.res.handFrameCount, classifyMs: r.res.ms, analysisMs: Math.round(r.res.analysisMs) } };
  row.match = !r.err && r.res.status === c.status && r.res.best === c.best;
  same += row.match; report.smoke.push(row);
  console.log(row.clip.slice(0, 34).padEnd(34), "truth", c.truth.padEnd(12), "→", r.err ?? `${r.res.status} ${r.res.label ?? r.res.best}`, row.match ? "" : `(ref ${c.status} ${c.best})`);
}
check("video upload predictions match the validated V3.1 Chrome results", same >= Math.ceil(smoke.length * 0.9), `${same}/${smoke.length} identical status+top-1`);
// strict: rerun the accepted ones; strict can only keep or downgrade an acceptance (same scores, tighter prototype threshold)
await setPolicy("strict"); let strictBad = 0, strictDowngrades = 0; report.strict = [];
for (const row of report.smoke.filter(x => x.deployed.status === "accepted").slice(0, 8)) {
  const c = smoke.find(s => s.video.endsWith(row.clip)); const r = await runVideo(c.video);
  report.strict.push({ clip: row.clip, truth: c.truth, balanced: row.deployed.status, strict: r.res.status, label: r.res.label ?? r.res.best, policy: r.res.policy, proto: r.res.scores.proto_cos });
  if (r.res.policy !== "strict" || r.res.best !== row.deployed.best) strictBad++;
  if (r.res.status !== "accepted") strictDowngrades++;
}
check("strict policy applied (same top-1, tighter acceptance)", strictBad === 0, `${report.strict.length} clips; ${strictDowngrades} downgraded from accepted`);
await setPolicy("balanced");
for (const v of unknownClips) {
  const r = await runVideo(v);
  report.unknown.push({ clip: v.split("/").pop(), status: r.res?.status, label: r.res?.label, best: r.res?.best, shown: r.shown, err: r.err });
  console.log("unsupported", v.split("/").pop().slice(0, 40), "→", r.err ?? `${r.res.status} (${r.shown})`);
}
if (unknownClips.length) {
  const rejected = report.unknown.filter(u => u.status !== "accepted").length;
  report.unknownRejected = `${rejected}/${report.unknown.length}`;
  check("unknown-sign path runs (UNKNOWN / abstain shown); rejection rate reported", report.unknown.every(u => !u.err && u.status) && rejected > 0,
    `${rejected}/${report.unknown.length} unsupported clips rejected (balanced): ` + report.unknown.map(u => `${u.clip.split("-")[1]}→${u.status}`).join(" "));
}

// ---------------------------------------------------------------- 3. camera lifecycle (fake camera through getUserMedia)
async function camRun(ms) {
  await page.click("#startcam");
  await page.waitForFunction(() => document.body.dataset.camera === "on", null, { timeout: 60000 });
  await page.waitForTimeout(ms);
  return page.evaluate(() => ({ diag: document.querySelector("#diag").textContent, stats: { ...window.__v3.state.stats, ms: undefined, recent: undefined },
    events: window.__v3.state.events.filter(e => e.source === "camera").length, live: document.querySelector("#cam").srcObject?.getTracks().map(t => t.readyState) }));
}
const c1 = await camRun(20000);
await page.click("#stopcam");
const afterStop = await page.evaluate(() => ({ src: !!document.querySelector("#cam").srcObject, state: document.body.dataset.camera, status: document.querySelector("#status").textContent }));
const c2 = await camRun(8000);
await page.click("#startcam"); // a second Start while running must be ignored
const dbl = await page.evaluate(() => window.__v3.state.running);
await page.click("#stopcam");
report.camera = { first: c1, afterStop, restart: c2 };
const fps = d => Number(/analysed ([\d.]+) fps/.exec(d)?.[1] ?? 0);
check("camera starts via getUserMedia and analyses frames", c1.stats.done > 50 && fps(c1.diag) > 3 && c1.live?.[0] === "live", c1.diag);
check("camera events produced from live frames", c1.events > 0, `${c1.events} recognition events in 20 s`);
check("stop releases the camera", !afterStop.src && afterStop.state === "off", afterStop.status);
check("restart works", c2.stats.done > 20 && fps(c2.diag) > 3 && dbl, c2.diag);
report.perf.camera = { diag: c1.diag, analysedFrames: c1.stats.done, skippedCameraFrames: c1.stats.skipped, windowSec: 20 };

// ---------------------------------------------------------------- 4. errors / network hygiene on the main session
const bad = sink.responses.filter(r => r.status >= 400);
check("no 4xx/5xx responses", bad.length === 0, bad.slice(0, 5).map(r => `${r.status} ${r.url}`).join(", "));
check("no requests to other origins (frames stay on-device)", sink.foreign.length === 0, sink.foreign.slice(0, 5).join(", "));
check("no uncaught page errors", sink.pageErrors.length === 0, sink.pageErrors.slice(0, 3).join(" | "));
// MediaPipe and ONNX Runtime print informational lines through console.error; those are recorded, not failures.
const BENIGN = [/^INFO: Created TensorFlow Lite XNNPACK delegate/, /onnxruntime.*cpuid_info.*Unknown CPU vendor/, /^W\d+ .*(gl_context|landmark_projection_calculator)/];
const realErrors = sink.consoleErrors.filter(m => !BENIGN.some(r => r.test(m)));
report.consoleBenign = [...new Set(sink.consoleErrors.filter(m => BENIGN.some(r => r.test(m))))];
check("no console errors (library info logs excluded)", realErrors.length === 0, realErrors.slice(0, 3).join(" | ") || `${sink.consoleErrors.length - realErrors.length} library info lines`);
report.network = { responses: sink.responses.length, requestsFailed: sink.failed, distinct: [...new Set(sink.responses.map(r => new URL(r.url).pathname))] };
await page.screenshot({ path: out.replace(/\.json$/, "-desktop.png"), fullPage: false });
await browser.close();

// ---------------------------------------------------------------- 5. permission denied
{
  // full headless Chrome ("chromium" channel): the headless shell cannot show or deny a permission prompt
  const b = await launch({ channel: "chromium", args: ["--no-sandbox", "--use-fake-device-for-media-stream", "--deny-permission-prompts"] });
  const c = await b.newContext(); const p = await c.newPage();
  await p.goto(`${origin}/`); await p.waitForSelector("body[data-ready]", { state: "attached", timeout: 240000 });
  await p.click("#startcam");
  await p.waitForFunction(() => window.__lastCameraError, null, { timeout: 30000 }).catch(() => {});
  const e = await p.evaluate(() => ({ err: window.__lastCameraError, status: document.querySelector("#status").textContent, running: window.__v3.state.running }));
  report.camera.denied = e;
  check("permission denial gives a useful message", e.err?.name === "NotAllowedError" && /permission was denied/i.test(e.status) && !e.running, e.status);
  await b.close();
}
// ---------------------------------------------------------------- 6. mobile layout
{
  const b = await launch({ args: ["--no-sandbox"] });
  const c = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const p = await c.newPage(); await p.goto(`${origin}/`); await p.waitForSelector("body[data-ready]", { state: "attached", timeout: 240000 });
  const m = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
  await p.screenshot({ path: out.replace(/\.json$/, "-mobile.png"), fullPage: true });
  check("mobile 390 px: no horizontal scroll", m.sw <= m.iw, `${m.sw} ≤ ${m.iw}`);
  await b.close();
}
report.finished = new Date().toISOString();
report.passed = Object.values(report.checks).filter(c => c.ok).length; report.total = Object.keys(report.checks).length;
report.environment = { runner: "Playwright headless Chromium", host_cpus: (await import("node:os")).cpus().length, gpu: "none (software GL)", note: "container, not a physical device" };
await writeFile(out, JSON.stringify(report, null, 1));
console.log(`\n${report.passed}/${report.total} checks passed`);
