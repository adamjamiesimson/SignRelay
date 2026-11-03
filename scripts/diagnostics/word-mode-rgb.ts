// Where does WORD-mode tracking time go? Licensed FSboard frames (prepared by
// tracking-determinism-prepare.py; runner-local) go through the PRODUCTION
// word-mode worker (gesture recognizer numHands 2 + face + pose; CPU) in
// lockstep on a 30 Hz schedule, once per auxiliary schedule, in rotating
// order. The one-hand shortcut is deliberately not a variant here.
//
// Per schedule: hands / face / pose / total per-frame cost (median, p95, max),
// hands cost split by how many hands were found (palm detection re-runs every
// frame while fewer than numHands are tracked), throughput if frames were
// processed back to back, face/pose age, hand-landmark parity with
// production, and ASL starter recognizer equivalence on sliding windows.
// Timings and counts only: no frames, landmarks or text leave the runner.
//
// usage: node scripts/diagnostics/run-word-mode.mjs <chrome> <out.json>
import { createServer } from "node:http";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { startChrome } from "./chrome-session.mjs";
import type { Sample } from "./tracking-determinism-rgb";
import type { VisionFrame } from "../../lib/vision-types";
import { recognizeAslStarter } from "../../lib/asl-starter-recognition";

const SCHEDULES = ["together", "alternate"] as const;
type Row = { frame: VisionFrame; timings: { hands: number; auxiliary: number; face?: number; pose?: number }; wallMs: number };
const quantile = (values: number[], q: number) => { const v = [...values].sort((a, b) => a - b); return v.length ? Math.round(v[Math.min(v.length - 1, Math.floor(q * v.length))] * 10) / 10 : null; };
const stats = (values: number[]) => ({ n: values.length, median: quantile(values, 0.5), p95: quantile(values, 0.95), max: quantile(values, 1) });

async function main() {
  const [chrome, out = "work/word-mode-rgb.json", roundsArg = "2"] = process.argv.slice(2);
  const rounds = Number(roundsArg);
  const root = resolve("work/determinism"), exportRoot = resolve("out");
  const samples: Sample[] = JSON.parse(readFileSync(join(root, "samples.json"), "utf8"));
  const types: Record<string, string> = { ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm", ".png": "image/png", ".html": "text/html", ".task": "application/octet-stream" };
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/") { res.setHeader("Content-Type", "text/html"); res.end("<!doctype html><title>word mode</title>"); return; }
    const base = url.pathname.startsWith("/frames/") ? root : exportRoot;
    const file = normalize(join(base, decodeURIComponent(url.pathname)));
    if (!file.startsWith(base) || !existsSync(file)) { res.statusCode = 404; res.end(); return; }
    res.setHeader("Content-Type", types[extname(file)] ?? "application/octet-stream"); res.end(readFileSync(file));
  });
  await new Promise<void>(r => server.listen(0, "127.0.0.1", () => r()));
  const browser = await startChrome(chrome, { proxy: undefined });
  try {
    await browser.send("Page.navigate", { url: `http://127.0.0.1:${(server.address() as { port: number }).port}/` });
    await new Promise(r => setTimeout(r, 1000));
    await browser.evaluate(`window.track = async (steps, auxSchedule) => {
      const worker = new Worker("/workers/vision.worker.js");
      const reply = (message, transfer, kind) => new Promise((resolve, reject) => {
        worker.onmessage = ({ data }) => { if (data.type === "error") reject(new Error(data.message)); else if (data.type === kind) resolve(data); };
        worker.onerror = e => reject(new Error(e.message)); worker.postMessage(message, transfer);
      });
      try {
        const ready = await reply({ type: "init", accelerated: false, auxSchedule }, [], "ready");
        if ((ready.auxSchedule ?? "together") !== auxSchedule) throw new Error("schedule not applied");
        const bitmaps = await Promise.all(steps.map(async s => createImageBitmap(await (await fetch(s.url)).blob())));
        const out = [];
        for (let k = 0; k < steps.length; k++) {
          const started = performance.now();
          const { frame, timings } = await reply({ type: "frame", bitmap: bitmaps[k], timestamp: steps[k].ts }, [bitmaps[k]], "result");
          out.push({ frame, timings, wallMs: performance.now() - started });
        }
        return out;
      } finally { worker.terminate(); }
    }; true`);
    const runs: Record<string, Row[][]> = Object.fromEntries(SCHEDULES.map(s => [s, samples.map(() => [] as Row[])]));
    const plans = samples.map(sample => {
      const steps: { url: string; ts: number }[] = []; let last = -Infinity;
      for (const f of sample.frames) { const slot = Math.floor(f.ms * 30 / 1000 + 1e-6); if (slot > last) { last = slot; steps.push({ url: f.png, ts: f.ms + 1000 }); } }
      return steps;
    });
    for (let round = 0; round < rounds; round++) {
      for (const [k] of samples.entries()) {
        const order = round % 2 ? [...SCHEDULES].reverse() : SCHEDULES;
        for (const schedule of order) {
          const rows = await browser.evaluate(`track(${JSON.stringify(plans[k])}, ${JSON.stringify(schedule)})`) as Row[];
          // Keep the first round's frames for parity; timings from every round.
          if (round === 0) runs[schedule][k] = rows;
          else runs[schedule][k] = runs[schedule][k].map((r, j) => ({ ...r, extra: [...((r as Row & { extra?: Row[] }).extra ?? []), rows[j]] }));
        }
      }
      console.log("WORD-MODE-ROUND", round + 1, "of", rounds);
    }
    const all = (schedule: string) => runs[schedule].flatMap(rows => rows.flatMap(r => [r, ...((r as Row & { extra?: Row[] }).extra ?? [])]));
    const frameKey = (f: VisionFrame) => JSON.stringify(f.hands.map(h => [h.handedness, h.gesture, h.landmarks.map(p => [p.x, p.y, p.z])]));
    const summary: Record<string, unknown> = {
      kind: "Licensed FSboard frames (exposed regression clips) through the production word-mode worker, CPU, lockstep 30 Hz; timing and equivalence, not accuracy",
      clips: samples.length, rounds, framesPerRound: plans.reduce((n, p) => n + p.length, 0),
    };
    for (const schedule of SCHEDULES) {
      const rows = all(schedule);
      const byHands = (n: number) => rows.filter(r => r.frame.hands.length === n).map(r => r.timings.hands);
      const aux = rows.filter(r => (r.timings.face ?? 0) > 0 || (r.timings.pose ?? 0) > 0);
      // Face/pose age: frames since that part last refreshed, at 30 Hz.
      const ages = { face: [] as number[], pose: [] as number[] };
      for (const clip of runs[schedule]) {
        let face = Infinity, pose = Infinity;
        clip.forEach((r, j) => { if ((r.timings.face ?? 0) > 0) face = j; if ((r.timings.pose ?? 0) > 0) pose = j; if (Number.isFinite(face)) ages.face.push((j - face) * 1000 / 30); if (Number.isFinite(pose)) ages.pose.push((j - pose) * 1000 / 30); });
      }
      const total = rows.map(r => r.timings.hands + r.timings.auxiliary);
      const meanWall = rows.reduce((n, r) => n + r.wallMs, 0) / rows.length;
      summary[schedule] = {
        hands: stats(rows.map(r => r.timings.hands)), handsWhen0: stats(byHands(0)), handsWhen1: stats(byHands(1)), handsWhen2: stats(byHands(2)),
        face: stats(aux.map(r => r.timings.face ?? 0).filter(v => v > 0)), pose: stats(aux.map(r => r.timings.pose ?? 0).filter(v => v > 0)),
        auxFrameShare: Math.round(aux.length / rows.length * 1000) / 1000,
        total: stats(total), wall: stats(rows.map(r => r.wallMs)), backToBackFps: Math.round(10000 / meanWall) / 10,
        within33ms: Math.round(total.filter(v => v <= 1000 / 30).length / total.length * 1000) / 1000,
        within66ms: Math.round(total.filter(v => v <= 1000 / 15).length / total.length * 1000) / 1000,
        faceAgeMs: stats(ages.face), poseAgeMs: stats(ages.pose),
      };
    }
    // Equivalence against production on the first round's frames.
    let handFrames = 0, handIdentical = 0, windows = 0, sameStarter = 0, starterHits = 0;
    for (const [k] of samples.entries()) {
      const a = runs.together[k], b = runs.alternate[k];
      a.forEach((r, j) => { handFrames++; if (frameKey(r.frame) === frameKey(b[j].frame)) handIdentical++; });
      for (let end = 30; end <= a.length; end += 5) {
        const pa = recognizeAslStarter(a.slice(end - 30, end).map(r => r.frame)), pb = recognizeAslStarter(b.slice(end - 30, end).map(r => r.frame));
        windows++; if ((pa?.label ?? null) === (pb?.label ?? null)) sameStarter++; if (pa) starterHits++;
      }
    }
    summary.equivalence = { handFrames, handLandmarksIdentical: handIdentical, starterWindows: windows, starterSameLabel: sameStarter, starterProductionPredictions: starterHits,
      note: "FSboard clips are fingerspelling, not starter words; starter equivalence here checks that schedules do not create or remove predictions, not recognition accuracy" };
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify({ summary }, null, 1));
    console.log("WORD-MODE-SUMMARY", JSON.stringify(summary));
  } finally { await browser.close(); server.close(); }
}
if (process.argv[1]?.includes("word-mode-rgb")) await main();
