// Where does fingerspelling tracking time go, and can it be reduced without
// changing what the tracker reports? Licensed FSboard frames (prepared by
// tracking-determinism-prepare.py; runner-local) go through the PRODUCTION
// tracking worker in lockstep on the production 15 Hz schedule, once per
// tracker variant, in rotating order, twice. For every variant the report has
// per-frame prep/inference/wall timing, landmark parity with the production
// configuration, and the decoded outcome via the production capture + CTC path.
// Counts, timings, CER and fingerprints only: no frames, landmarks or text.
//
// usage: node scripts/diagnostics/run-tracker-variants.mjs <chrome> <out.json>
import { createServer } from "node:http";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { startChrome } from "./chrome-session.mjs";
import { createSession, replayData } from "./replay-fingerspelling-trace";
import { schedules, compareFrames, type Sample, type Step } from "./tracking-determinism-rgb";
import type { StageFingerprints } from "../../lib/pipeline-fingerprint";
import type { HandObservation } from "../../lib/vision-types";

type Variant = { name: string; engine: "gesture" | "landmarker"; numHands: 1 | 2 };
export const VARIANTS: Variant[] = [
  { name: "gesture-2 (production)", engine: "gesture", numHands: 2 },
  { name: "landmarker-2", engine: "landmarker", numHands: 2 },
  { name: "gesture-1", engine: "gesture", numHands: 1 },
  { name: "landmarker-1", engine: "landmarker", numHands: 1 },
];
type Run = { hands: HandObservation[]; handsMs: number; prepMs: number; inferMs: number; wallMs: number }[];
const quantile = (values: number[], q: number) => { const v = [...values].sort((a, b) => a - b); return v.length ? Math.round(v[Math.min(v.length - 1, Math.floor(q * v.length))] * 10) / 10 : null; };
const levenshtein = (a: string, b: string) => {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) { let p = row[0]; row[0] = i; for (let j = 1; j <= b.length; j++) { const v = Math.min(row[j] + 1, row[j - 1] + 1, p + (a[i - 1] === b[j - 1] ? 0 : 1)); p = row[j]; row[j] = v; } }
  return row[b.length];
};

async function main() {
  const [chrome, out = "work/tracker-variants-rgb.json"] = process.argv.slice(2);
  const root = resolve("work/determinism"), exportRoot = resolve("out");
  const samples: Sample[] = JSON.parse(readFileSync(join(root, "samples.json"), "utf8"));
  const types: Record<string, string> = { ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm", ".png": "image/png", ".html": "text/html" };
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/") { res.setHeader("Content-Type", "text/html"); res.end("<!doctype html><title>tracker variants</title>"); return; }
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
    // Frames are decoded and scaled exactly as before; decoding is NOT timed.
    await browser.evaluate(`window.track = async (urls, steps, options) => {
      const bitmaps = [];
      for (const { i } of steps) {
        const source = await createImageBitmap(await (await fetch(urls[i])).blob());
        const ratio = Math.min(1, 640 / source.width, 640 / source.height);
        const w = Math.max(1, Math.round(source.width * ratio)), h = Math.max(1, Math.round(source.height * ratio));
        const canvas = new OffscreenCanvas(w, h); canvas.getContext("2d").drawImage(source, 0, 0, w, h); source.close();
        bitmaps.push(canvas.transferToImageBitmap());
      }
      const worker = new Worker("/workers/fingerspelling-vision.worker.js");
      const reply = (message, transfer, kind) => new Promise((resolve, reject) => {
        worker.onmessage = ({ data }) => { if (data.type === "error") reject(new Error(data.message)); else if (data.type === kind) resolve(data); };
        worker.onerror = e => reject(new Error(e.message)); worker.postMessage(message, transfer);
      });
      try {
        const ready = await reply({ type: "init", ...options }, [], "ready");
        if (ready.engine !== options.engine || ready.numHands !== options.numHands) throw new Error("variant not applied");
        const out = [];
        for (let k = 0; k < steps.length; k++) {
          const posted = performance.now();
          const { frame, timings } = await reply({ type: "frame", bitmap: bitmaps[k], timestamp: steps[k].ts }, [bitmaps[k]], "result");
          out.push({ hands: frame.hands, handsMs: timings.hands, prepMs: timings.prep, inferMs: timings.infer, wallMs: performance.now() - posted });
        }
        return out;
      } finally { worker.terminate(); }
    }; true`);
    const timing: Record<string, { hands: number[]; prep: number[]; infer: number[]; wall: number[] }> = Object.fromEntries(VARIANTS.map(v => [v.name, { hands: [], prep: [], infer: [], wall: [] }]));
    const cases: Record<string, unknown>[] = [];
    for (const [k, sample] of samples.entries()) {
      const steps: Step[] = schedules(sample, false).A.steps;
      const urls = sample.frames.map(f => f.png);
      const runs: Record<string, Run[]> = {};
      for (let repeat = 0; repeat < 2; repeat++) {
        const order = VARIANTS.map((_, j) => VARIANTS[(j + k + repeat) % VARIANTS.length]);
        for (const variant of order) {
          const run = await browser.evaluate(`track(${JSON.stringify(urls)}, ${JSON.stringify(steps)}, ${JSON.stringify({ engine: variant.engine, numHands: variant.numHands })})`) as Run;
          (runs[variant.name] ??= []).push(run);
          // The first frames include allocation warm-up; keep them out of throughput.
          for (const f of run.slice(3)) { const t = timing[variant.name]; t.hands.push(f.handsMs); t.prep.push(f.prepMs); t.infer.push(f.inferMs); t.wall.push(f.wallMs); }
        }
      }
      const production = { steps, tracked: runs[VARIANTS[0].name][0] };
      const row: Record<string, unknown> = { case: sample.index, role: sample.role, frames: steps.length, detected: production.tracked.filter(t => t.hands.length).length, variants: {} };
      for (const variant of VARIANTS) {
        const run = runs[variant.name][0];
        const inside = steps.map((s, j) => ({ s, j })).filter(({ s }) => sample.frames[s.i].ms >= sample.annotationStartMs && sample.frames[s.i].ms <= sample.annotationEndMs);
        const trace = { schema: "signrelay-fingerspelling-trace-v1", aspect: sample.width / sample.height, featureVersion: "v3",
          samples: inside.map(({ s, j }) => ({ time: s.ts, capturedAt: s.ts, hands: run[j].hands })) };
        const result = await replayData(session, trace, `case-${sample.index}-${variant.name}`, true);
        const text = (result.text ?? "").trim();
        (row.variants as Record<string, unknown>)[variant.name] = {
          parity: compareFrames(production, { steps, tracked: run }),
          repeatParity: compareFrames({ steps, tracked: run }, { steps, tracked: runs[variant.name][1] }),
          handsPerFrame: run.reduce((n, f) => n + f.hands.length, 0) / run.length,
          status: result.captureError ? "quality-rejected" : result.status, exact: text === sample.reference,
          edits: levenshtein(text, sample.reference), referenceCharacters: sample.reference.length,
          fingerprints: result.fingerprints as StageFingerprints };
      }
      cases.push(row);
      console.log("TRACKER-VARIANTS-CASE", JSON.stringify({ case: sample.index, variants: Object.fromEntries(Object.entries(row.variants as Record<string, { parity: { identical: number; compared: number }; exact: boolean; edits: number }>).map(([n, v]) => [n, [v.parity.identical, v.parity.compared, v.exact, v.edits]])) }));
    }
    const summary = {
      kind: "Licensed FSboard frames through the production tracking worker in lockstep on the production 15 Hz schedule; per-variant cost and parity. Exposed regression clips; not webcam evidence.",
      variants: Object.fromEntries(VARIANTS.map(v => {
        const t = timing[v.name], rows = cases.map(c => (c.variants as Record<string, { parity: { compared: number; identical: number; maxLandmarkDelta: number; detectionMismatch: number }; repeatParity: { identical: number; compared: number }; exact: boolean; edits: number; referenceCharacters: number; fingerprints: StageFingerprints }>)[v.name]);
        const base = cases.map(c => (c.variants as Record<string, { fingerprints: StageFingerprints }>)[VARIANTS[0].name]);
        return [v.name, {
          handsMs: { median: quantile(t.hands, .5), p95: quantile(t.hands, .95) }, prepMs: { median: quantile(t.prep, .5), p95: quantile(t.prep, .95) },
          inferMs: { median: quantile(t.infer, .5), p95: quantile(t.infer, .95) }, wallMs: { median: quantile(t.wall, .5), p95: quantile(t.wall, .95) },
          sustainable15HzFraction: t.wall.length ? Math.round(1000 * t.wall.filter(w => w <= 1000 / 15).length / t.wall.length) / 1000 : null,
          framesTimed: t.wall.length,
          parityWithProduction: { frames: rows.reduce((n, r) => n + r.parity.compared, 0), identical: rows.reduce((n, r) => n + r.parity.identical, 0),
            detectionMismatch: rows.reduce((n, r) => n + r.parity.detectionMismatch, 0), maxLandmarkDelta: Math.max(0, ...rows.map(r => r.parity.maxLandmarkDelta)) },
          repeatIdentical: { frames: rows.reduce((n, r) => n + r.repeatParity.compared, 0), identical: rows.reduce((n, r) => n + r.repeatParity.identical, 0) },
          sameOutputAsProduction: rows.filter((r, j) => r.fingerprints?.output === base[j].fingerprints?.output).length,
          exact: rows.filter(r => r.exact).length, edits: rows.reduce((n, r) => n + r.edits, 0), characters: rows.reduce((n, r) => n + r.referenceCharacters, 0), clips: rows.length }];
      })),
    };
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify({ summary, cases }, null, 1));
    console.log("TRACKER-VARIANTS-SUMMARY", JSON.stringify(summary));
  } finally { await session.release(); await browser.close(); server.close(); }
}
if (process.argv[1]?.includes("tracker-variants-rgb")) await main();
