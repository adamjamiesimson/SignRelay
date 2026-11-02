// How sensitive is decoded fingerspelling to WHICH frames the tracker sees?
// Licensed FSboard frames (tracking-determinism-prepare.py; runner-local) go
// through the production tracking worker in lockstep under controlled
// schedule perturbations, for each tracker configuration under test. Every
// schedule is captured and decoded by the production path. No landmark is
// invented: dropped frames are simply absent; "hand loss" frames are real
// frames with the hand region replaced by background, which the tracker
// genuinely observes as no hand.
//
//   A        production 15 Hz lattice              (reference)
//   shift    lattice shifted by one native frame
//   drop1/2/3  1, 2 or 3 consecutive lattice samples removed mid-sign
//   rand10/25  10 % / 25 % of lattice samples removed (seeded)
//   loss200  ~200 ms of frames with the image blanked (hand not visible)
//   fast/slow  movement at 1.25x / 0.8x speed (source frames re-timed; real pixels)
//
// Reports output agreement with A, exact/edits and quality rejections per
// schedule and configuration. Counts, CER and fingerprints only.
//
// usage: node scripts/diagnostics/run-stability-grid.mjs <chrome> <out.json> [engine:numHands,...]
import { createServer } from "node:http";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { startChrome } from "./chrome-session.mjs";
import { createSession, replayData } from "./replay-fingerspelling-trace";
import type { Sample, Step } from "./tracking-determinism-rgb";
import type { HandObservation } from "../../lib/vision-types";

type Plan = { steps: (Step & { blank?: boolean })[] };
const seeded = (seed: number) => () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const levenshtein = (a: string, b: string) => {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) { let p = row[0]; row[0] = i; for (let j = 1; j <= b.length; j++) { const v = Math.min(row[j] + 1, row[j - 1] + 1, p + (a[i - 1] === b[j - 1] ? 0 : 1)); p = row[j]; row[j] = v; } }
  return row[b.length];
};

/** Schedules over the native decoded frames; timestamps are source time + 1 s. */
export function grid(sample: Sample) {
  const frames = sample.frames, mid = (sample.annotationStartMs + sample.annotationEndMs) / 2;
  const lattice = (time: (ms: number) => number = ms => ms) => {
    const out: Step[] = []; let last = -Infinity;
    frames.forEach((f, i) => { const slot = Math.floor(time(f.ms) * 15 / 1000 + 1e-6); if (slot > last) { last = slot; out.push({ i, ts: time(f.ms) + 1000 }); } });
    return out;
  };
  const A = lattice();
  const centre = A.reduce((best, s, k) => Math.abs(frames[s.i].ms - mid) < Math.abs(frames[A[best].i].ms - mid) ? k : best, 0);
  const drop = (n: number) => A.filter((_, k) => k < centre || k >= centre + n);
  const random = (fraction: number, seed: number) => { const r = seeded(seed); return A.filter((_, k) => k === 0 || r() >= fraction); };
  // Movement speed: the same real frames, shown on a compressed/stretched clock.
  const speed = (factor: number) => lattice(ms => ms / factor);
  const plans: Record<string, Plan> = {
    A: { steps: A }, shift: { steps: lattice(ms => ms + 1000 / 30) },
    drop1: { steps: drop(1) }, drop2: { steps: drop(2) }, drop3: { steps: drop(3) },
    rand10: { steps: random(0.1, 7) }, rand25: { steps: random(0.25, 11) },
    loss200: { steps: A.map(s => ({ ...s, blank: Math.abs(frames[s.i].ms - mid) <= 100 })) },
    fast: { steps: speed(1.25) }, slow: { steps: speed(0.8) },
  };
  return { plans, window: (s: Step, name: string) => {
    const factor = name === "fast" ? 1.25 : name === "slow" ? 0.8 : 1;
    const shift = name === "shift" ? 1000 / 30 : 0;
    const t = s.ts - 1000;
    return t >= sample.annotationStartMs / factor + shift && t <= sample.annotationEndMs / factor + shift;
  } };
}

async function main() {
  const [chrome, out = "work/stability-grid-rgb.json", configArg = "gesture:2"] = process.argv.slice(2);
  const configs = configArg.split(",").map(c => { const [engine, hands] = c.split(":"); return { name: c, engine, numHands: Number(hands) }; });
  const root = resolve("work/determinism"), exportRoot = resolve("out");
  const samples: Sample[] = JSON.parse(readFileSync(join(root, "samples.json"), "utf8"));
  const types: Record<string, string> = { ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm", ".png": "image/png", ".html": "text/html" };
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/") { res.setHeader("Content-Type", "text/html"); res.end("<!doctype html><title>stability grid</title>"); return; }
    const base = url.pathname.startsWith("/frames/") ? root : exportRoot;
    const file = normalize(join(base, decodeURIComponent(url.pathname)));
    if (!file.startsWith(base) || !existsSync(file)) { res.statusCode = 404; res.end(); return; }
    res.setHeader("Content-Type", types[extname(file)] ?? "application/octet-stream"); res.end(readFileSync(file));
  });
  await new Promise<void>(r => server.listen(0, "127.0.0.1", () => r()));
  const browser = await startChrome(chrome, { proxy: undefined });
  const session = await createSession();
  try {
    await browser.send("Page.navigate", { url: `http://127.0.0.1:${(server.address() as { port: number }).port}/` });
    await new Promise(r => setTimeout(r, 1000));
    await browser.evaluate(`window.track = async (urls, steps, options) => {
      const worker = new Worker("/workers/fingerspelling-vision.worker.js");
      const reply = (message, transfer, kind) => new Promise((resolve, reject) => {
        worker.onmessage = ({ data }) => { if (data.type === "error") reject(new Error(data.message)); else if (data.type === kind) resolve(data); };
        worker.onerror = e => reject(new Error(e.message)); worker.postMessage(message, transfer);
      });
      try {
        const ready = await reply({ type: "init", ...options }, [], "ready");
        if (ready.engine !== options.engine || ready.numHands !== options.numHands) throw new Error("configuration not applied");
        const out = [];
        for (const { i, ts, blank } of steps) {
          const source = await createImageBitmap(await (await fetch(urls[i])).blob());
          const ratio = Math.min(1, 640 / source.width, 640 / source.height);
          const w = Math.max(1, Math.round(source.width * ratio)), h = Math.max(1, Math.round(source.height * ratio));
          const canvas = new OffscreenCanvas(w, h), ctx = canvas.getContext("2d");
          if (blank) { ctx.fillStyle = "#20242c"; ctx.fillRect(0, 0, w, h); } else ctx.drawImage(source, 0, 0, w, h);
          source.close();
          const bitmap = canvas.transferToImageBitmap();
          const { frame, timings } = await reply({ type: "frame", bitmap, timestamp: ts }, [bitmap], "result");
          out.push({ hands: frame.hands, ms: timings.hands });
        }
        return out;
      } finally { worker.terminate(); }
    }; true`);
    const rows: Record<string, unknown>[] = [];
    for (const sample of samples) {
      const { plans, window } = grid(sample);
      const urls = sample.frames.map(f => f.png);
      const row: Record<string, unknown> = { case: sample.index, role: sample.role, configs: {} };
      for (const config of configs) {
        const results: Record<string, { status: string; text: string; output?: string }> = {};
        for (const [name, plan] of Object.entries(plans)) {
          const tracked = await browser.evaluate(`track(${JSON.stringify(urls)}, ${JSON.stringify(plan.steps)}, ${JSON.stringify({ engine: config.engine, numHands: config.numHands })})`) as { hands: HandObservation[] }[];
          const inside = plan.steps.map((s, k) => ({ s, k })).filter(({ s }) => window(s, name));
          const trace = { schema: "signrelay-fingerspelling-trace-v1", aspect: sample.width / sample.height, featureVersion: "v3",
            samples: inside.map(({ s, k }) => ({ time: s.ts, capturedAt: s.ts, hands: tracked[k].hands })) };
          const result = await replayData(session, trace, `case-${sample.index}-${config.name}-${name}`, true);
          results[name] = { status: result.captureError ? "quality-rejected" : result.status, text: (result.text ?? "").trim(), output: result.fingerprints.output };
        }
        (row.configs as Record<string, unknown>)[config.name] = Object.fromEntries(Object.entries(results).map(([name, r]) => [name, {
          status: r.status, sameOutputAsA: (r.output ?? r.status) === (results.A.output ?? results.A.status),
          exact: r.text === sample.reference, edits: levenshtein(r.text, sample.reference), referenceCharacters: sample.reference.length }]));
      }
      rows.push(row);
      console.log("STABILITY-CASE", sample.index);
    }
    const names = Object.keys(grid(samples[0]).plans);
    const summary = { kind: "Licensed FSboard frames, production tracker in lockstep under controlled schedule perturbations; exposed regression clips; sensitivity, not accuracy",
      clips: rows.length, configs: Object.fromEntries(configs.map(c => [c.name, Object.fromEntries(names.map(name => {
        const cells = rows.map(r => ((r.configs as Record<string, Record<string, { status: string; sameOutputAsA: boolean; exact: boolean; edits: number; referenceCharacters: number }>>)[c.name])[name]);
        return [name, { sameOutputAsA: cells.filter(x => x.sameOutputAsA).length, exact: cells.filter(x => x.exact).length,
          edits: cells.reduce((n, x) => n + x.edits, 0), characters: cells.reduce((n, x) => n + x.referenceCharacters, 0),
          qualityRejected: cells.filter(x => x.status === "quality-rejected").length }];
      }))])) };
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify({ summary, cases: rows }, null, 1));
    console.log("STABILITY-SUMMARY", JSON.stringify(summary));
  } finally { await session.release(); await browser.close(); server.close(); }
}
if (process.argv[1]?.includes("stability-grid-rgb")) await main();
