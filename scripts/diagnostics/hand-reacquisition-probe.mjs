#!/usr/bin/env node
// Measures hand-tracking continuity under motion with the pinned MediaPipe
// runtime: the pre-repair call pattern against the production VisionEngine.
//   node scripts/diagnostics/hand-reacquisition-probe.mjs /path/to/chrome [out.json]
// Needs `npm run install:vision-assets` and network access to MediaPipe's
// public test photos (storage.googleapis.com/mediapipe-assets), which are
// downloaded to the git-ignored work/ and never committed.
// The stimulus is a translated still photograph. It shows what the tracker does
// when a hand moves quickly; it is not signing, not a camera and not accuracy.
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { build } from "esbuild";
import { startChrome } from "./chrome-session.mjs";

const [chrome, outFile] = process.argv.slice(2);
if (!chrome) { console.error("Usage: hand-reacquisition-probe.mjs /path/to/chrome [out.json]"); process.exit(2); }
const work = resolve("work/hand-reacquisition-probe");
mkdirSync(work, { recursive: true });
const PHOTOS = { "thumb_up.jpg": 260, "fist.jpg": 230, "woman_hands.jpg": 460 };
for (const name of Object.keys(PHOTOS)) {
  const file = join(work, name);
  if (existsSync(file)) continue;
  const response = await fetch(`https://storage.googleapis.com/mediapipe-assets/${name}`, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`Could not download the public test photo ${name}: ${response.status}`);
  writeFileSync(file, Buffer.from(await response.arrayBuffer()));
}
if (!existsSync("public/vision/models/gesture_recognizer.task")) throw new Error("Run `npm run install:vision-assets` first");
await build({ entryPoints: ["scripts/diagnostics/hand-reacquisition-probe.ts"], bundle: true, format: "esm", platform: "browser",
  target: "es2020", outfile: join(work, "probe.js"), logLevel: "error" });
writeFileSync(join(work, "index.html"), '<!doctype html><canvas width="640" height="480"></canvas><script type="module" src="/probe.js"></script>');

const types = { ".html": "text/html", ".js": "text/javascript", ".wasm": "application/wasm", ".jpg": "image/jpeg" };
const server = createServer((request, response) => {
  const path = decodeURIComponent(new URL(request.url, "http://x").pathname);
  if (path.includes("..")) { response.writeHead(400).end(); return; }
  const file = path.startsWith("/vision/") ? join("public", path) : join(work, path === "/" ? "index.html" : path);
  if (!existsSync(file)) { response.writeHead(404).end(); return; }
  response.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" }).end(readFileSync(file));
}).listen(0, "127.0.0.1");
await new Promise(done => server.once("listening", done));

const cases = [];
for (const [name, height] of Object.entries(PHOTOS)) {
  for (const interval of [50, 66]) {
    for (const speed of [0, 300, 600, 1000, 1500]) cases.push({ image: `/${name}`, height, path: "sweep", speed, interval });
    for (const speed of [600, 1000]) cases.push({ image: `/${name}`, height, path: "nod", speed, interval });
  }
  cases.push({ image: `/${name}`, height, path: "exit", speed: 300, interval: 50 });
}
cases.push({ image: "", height: 0, path: "empty", speed: 0, interval: 50 });

const session = await startChrome(chrome, { proxy: "" });
try {
  await session.send("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/` });
  for (let i = 0; i < 100 && !(await session.evaluate("typeof window.probe === 'function'")); i++) await new Promise(done => setTimeout(done, 200));
  const rows = [];
  for (const test of cases) rows.push(await session.evaluate(`window.probe(${JSON.stringify(test)})`));
  const moving = rows.filter(row => row.path === "sweep" || row.path === "nod");
  const total = key => moving.reduce((sum, row) => sum + row[key].seen, 0);
  const report = {
    scope: "Tracker continuity for a translated public still photo. Not signing, not a camera, not recognition accuracy.",
    moving_runs: moving.length, moving_frames: moving.reduce((sum, row) => sum + row.frames, 0),
    baseline_hand_frames: total("baseline"), candidate_hand_frames: total("candidate"),
    baseline_runs_with_a_dropped_frame: moving.filter(row => row.baseline.seen < row.frames).length,
    candidate_runs_with_a_dropped_frame: moving.filter(row => row.candidate.seen < row.frames).length,
    retries: rows.reduce((sum, row) => sum + row.reacquisition.attempts, 0),
    retries_recovered: rows.reduce((sum, row) => sum + row.reacquisition.recovered, 0),
    // After the photo leaves, or with no hand at all, the candidate must not report a hand the baseline does not.
    hand_frames_after_exit_or_in_empty_scene: rows.filter(row => row.path === "exit" || row.path === "empty")
      .map(row => ({ path: row.path, image: row.image, baseline: row.baseline.pattern, candidate: row.candidate.pattern, retries: row.reacquisition.attempts })),
    rows,
  };
  const text = JSON.stringify(report, null, 2);
  if (outFile) writeFileSync(outFile, text + "\n");
  console.log(JSON.stringify({ ...report, rows: undefined, hand_frames_after_exit_or_in_empty_scene: undefined }, null, 2));
  for (const row of rows) console.log(`${row.path.padEnd(5)} ${String(row.speed).padStart(4)} px/s ${row.interval} ms ${row.image.padEnd(16)} base ${row.baseline.pattern}\n${" ".repeat(38)} new  ${row.candidate.pattern}`);
} finally { await session.close(); server.close(); }
