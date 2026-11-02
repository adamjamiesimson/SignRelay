// Real-hand tracker determinism and schedule sensitivity (licensed FSboard
// frames prepared by tracking-determinism-prepare.py; runner-local only).
//
// Every decoded frame is fed to the PRODUCTION fingerspelling tracking worker
// from the rehearsal export, in lockstep (no camera, no wall-clock drops), under
// controlled schedules. Each schedule is then captured and decoded exactly as
// production does (FingerspellingCapture v3 -> installed ONNX -> interpretCtcLogits).
//
//   A    production 15 Hz decoded-media lattice (first frame in each slot)
//   A2   A again with a fresh worker              -> MediaPipe repeatability
//   T    A pixels, timestamps jittered +-4 ms     -> timestamp sensitivity
//   P    lattice shifted by one 30 fps frame      -> which-frames sensitivity
//   D1   A without one mid-annotation frame       -> tracking-state carry-over
//   G    A without ~300 ms mid-annotation         -> interruption handling
//   M,M2 mirrored A twice (rare cases only)       -> repeatability on mirrored RGB
//
// The report holds counts, deltas, CER and stage fingerprints. It never holds
// landmarks, decoded text, references or clip identifiers.
//
// usage: node scripts/diagnostics/run-tracking-determinism.mjs <chrome> <out.json>
import { createServer } from "node:http";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { startChrome } from "./chrome-session.mjs";
import { createSession, replayData } from "./replay-fingerspelling-trace";
import { firstDivergentStage, fingerprintObservations, type StageFingerprints } from "../../lib/pipeline-fingerprint";
import type { HandObservation } from "../../lib/vision-types";

export type Frame = { ms: number; png: string; rgbSha256: string };
export type Sample = { index: number; role: string; rare: boolean; reference: string; annotationStartMs: number; annotationEndMs: number; width: number; height: number; nativeFps: number; frames: Frame[] };
export type Step = { i: number; ts: number };
export type Tracked = { hands: HandObservation[]; handsMs: number }[];
const OFFSET = 1000; // tracker timestamps must exceed its warm-up probe time

export function schedules(sample: Sample, mirroredVariants: boolean) {
  const frames = sample.frames, mid = (sample.annotationStartMs + sample.annotationEndMs) / 2;
  const lattice = (shift: number) => {
    const out: Step[] = []; let last = -Infinity;
    frames.forEach((f, i) => { const slot = Math.floor((f.ms + shift) * 15 / 1000 + 1e-6); if (slot > last) { last = slot; out.push({ i, ts: f.ms + OFFSET }); } });
    return out;
  };
  const A = lattice(0);
  const nearest = A.reduce((best, s) => Math.abs(frames[s.i].ms - mid) < Math.abs(frames[best.i].ms - mid) ? s : best, A[0]);
  const result: Record<string, { steps: Step[]; mirror: boolean }> = {
    A: { steps: A, mirror: false }, A2: { steps: A, mirror: false },
    T: { steps: A.map((s, k) => ({ i: s.i, ts: s.ts + ((k * 7919) % 9) - 4 })), mirror: false },
    P: { steps: lattice(1000 / 30), mirror: false },
    D1: { steps: A.filter(s => s !== nearest), mirror: false },
    G: { steps: A.filter(s => Math.abs(frames[s.i].ms - mid) > 150), mirror: false },
  };
  if (mirroredVariants) { result.M = { steps: A, mirror: true }; result.M2 = { steps: A, mirror: true }; }
  return result;
}

const levenshtein = (a: string, b: string) => {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0]; row[0] = i;
    for (let j = 1; j <= b.length; j++) { const value = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1)); previous = row[j]; row[j] = value; }
  }
  return row[b.length];
};

/** Per-frame landmark agreement on the frames two schedules share. */
export function compareFrames(a: { steps: Step[]; tracked: Tracked }, b: { steps: Step[]; tracked: Tracked }, after?: number) {
  const byIndex = new Map(b.steps.map((s, k) => [s.i, b.tracked[k]]));
  let compared = 0, identical = 0, detectionMismatch = 0, maxDelta = 0, firstIdenticalAfter: number | null = null, bothDetected = 0;
  a.steps.forEach((s, k) => {
    if (after !== undefined && s.i <= after) return;
    const other = byIndex.get(s.i); if (!other) return;
    const x = a.tracked[k];
    compared++;
    if (fingerprintObservations([x]) === fingerprintObservations([other])) { identical++; if (after !== undefined && firstIdenticalAfter === null) firstIdenticalAfter = compared; }
    if (!!x.hands.length !== !!other.hands.length) detectionMismatch++;
    if (x.hands.length && other.hands.length) {
      bothDetected++;
      x.hands[0].landmarks.forEach((p, j) => { const q = other.hands[0].landmarks[j]; if (q) maxDelta = Math.max(maxDelta, Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z)); });
    }
  });
  return { compared, identical, bothDetected, detectionMismatch, maxLandmarkDelta: maxDelta, ...(after !== undefined ? { firstIdenticalAfterDrop: firstIdenticalAfter } : {}) };
}

async function main() {
  const [chrome, out = "work/tracking-determinism-rgb.json"] = process.argv.slice(2);
  const root = resolve("work/determinism"), exportRoot = resolve("out");
  const samples: Sample[] = JSON.parse(readFileSync(join(root, "samples.json"), "utf8"));
  const types: Record<string, string> = { ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm", ".png": "image/png", ".html": "text/html", ".json": "application/json" };
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/") { res.setHeader("Content-Type", "text/html"); res.end("<!doctype html><title>tracker determinism</title>"); return; }
    const base = url.pathname.startsWith("/frames/") ? root : exportRoot;
    const file = normalize(join(base, decodeURIComponent(url.pathname)));
    if (!file.startsWith(base) || !existsSync(file)) { res.statusCode = 404; res.end(); return; }
    res.setHeader("Content-Type", types[extname(file)] ?? "application/octet-stream"); res.end(readFileSync(file));
  });
  await new Promise<void>(r => server.listen(0, "127.0.0.1", () => r()));
  const browser = await startChrome(chrome, { proxy: undefined });
  const session = await createSession();
  const report: Record<string, unknown>[] = [];
  try {
    await browser.send("Page.navigate", { url: `http://127.0.0.1:${(server.address() as { port: number }).port}/` });
    await new Promise(r => setTimeout(r, 1000));
    await browser.evaluate(`window.track = async (urls, steps, mirror) => {
      const worker = new Worker("/workers/fingerspelling-vision.worker.js");
      const reply = (message, transfer, kind) => new Promise((resolve, reject) => {
        worker.onmessage = ({ data }) => { if (data.type === "error") reject(new Error(data.message)); else if (data.type === kind) resolve(data); };
        worker.onerror = e => reject(new Error(e.message)); worker.postMessage(message, transfer);
      });
      try {
        const ready = await reply({ type: "init" }, [], "ready");
        if (ready.delegate !== "CPU") throw new Error("unexpected delegate");
        const out = [];
        for (const { i, ts } of steps) {
          const source = await createImageBitmap(await (await fetch(urls[i])).blob());
          // Same downscale as LiveVision's decoded-frame snapshot.
          const ratio = Math.min(1, 640 / source.width, 640 / source.height);
          const w = Math.max(1, Math.round(source.width * ratio)), h = Math.max(1, Math.round(source.height * ratio));
          const canvas = new OffscreenCanvas(w, h), ctx = canvas.getContext("2d");
          if (mirror) { ctx.translate(w, 0); ctx.scale(-1, 1); }
          ctx.drawImage(source, 0, 0, w, h); source.close();
          const bitmap = canvas.transferToImageBitmap();
          const { frame, timings } = await reply({ type: "frame", bitmap, timestamp: ts }, [bitmap], "result");
          out.push({ hands: frame.hands, handsMs: timings.hands });
        }
        return out;
      } finally { worker.terminate(); }
    }; true`);
    for (const sample of samples) {
      const plan = schedules(sample, sample.rare);
      const urls = sample.frames.map(f => f.png);
      const runs: Record<string, { steps: Step[]; tracked: Tracked; result?: Awaited<ReturnType<typeof replayData>> & { text?: string } }> = {};
      for (const [name, { steps, mirror }] of Object.entries(plan)) {
        const tracked = await browser.evaluate(`track(${JSON.stringify(urls)}, ${JSON.stringify(steps)}, ${mirror})`) as Tracked;
        // Production boundaries: only samples between Start and Finish enter the capture.
        const inside = steps.map((s, k) => ({ s, k })).filter(({ s }) => sample.frames[s.i].ms >= sample.annotationStartMs && sample.frames[s.i].ms <= sample.annotationEndMs);
        const trace = { schema: "signrelay-fingerspelling-trace-v1", aspect: sample.width / sample.height, featureVersion: "v3",
          samples: inside.map(({ s, k }) => ({ time: s.ts, capturedAt: s.ts, hands: tracked[k].hands })) };
        runs[name] = { steps, tracked, result: await replayData(session, trace, `case-${sample.index}-${name}`, true) };
      }
      const row: Record<string, unknown> = { case: sample.index, role: sample.role, rare: sample.rare, nativeFps: sample.nativeFps, decodedFrames: sample.frames.length };
      const A = runs.A, inA = A.steps.filter(s => sample.frames[s.i].ms >= sample.annotationStartMs && sample.frames[s.i].ms <= sample.annotationEndMs).length;
      row.latticeFramesInCapture = inA;
      row.detectedFramesA = A.tracked.filter(t => t.hands.length).length;
      row.conclusive = (row.detectedFramesA as number) > 0;
      row.trackingMsMedian = [...A.tracked.map(t => t.handsMs)].sort((a, b) => a - b)[Math.floor(A.tracked.length / 2)];
      row.schedules = Object.fromEntries(Object.entries(runs).map(([name, run]) => {
        const text = (run.result?.text ?? "").trim(), reference = sample.reference;
        const status = run.result?.captureError ? "quality-rejected" : run.result?.status;
        return [name, { status, candidate: !!text && status !== "quality-rejected", exact: text === reference, edits: levenshtein(text, reference), referenceCharacters: reference.length,
          fingerprints: run.result?.fingerprints as StageFingerprints, captureError: run.result?.captureError ? String(run.result.captureError).replace(/^Error: /, "") : undefined }];
      }));
      const fp = (name: string) => runs[name]?.result?.fingerprints as StageFingerprints;
      // Variants that change timestamps or frames always differ at "schedule";
      // the informative question is the first stage after it.
      const beyond = (x: string, y: string) => firstDivergentStage({ ...fp(x), schedule: undefined }, { ...fp(y), schedule: undefined });
      const dropIndex = A.steps.find(s => !runs.D1.steps.includes(s))?.i;
      row.comparisons = {
        repeat: { ...compareFrames(A, runs.A2), firstDivergentStage: firstDivergentStage(fp("A"), fp("A2")) },
        timestampJitter: { ...compareFrames(A, runs.T), firstDivergentStage: beyond("A", "T") },
        phaseShift: { firstDivergentStage: beyond("A", "P"), sameOutput: fp("A")?.output === fp("P")?.output },
        singleDrop: { ...compareFrames(A, runs.D1, dropIndex), firstDivergentStage: beyond("A", "D1"), sameOutput: fp("A")?.output === fp("D1")?.output },
        interruption: { status: (row.schedules as Record<string, { status: string }>).G.status },
        ...(runs.M ? { mirroredRepeat: { ...compareFrames(runs.M, runs.M2), firstDivergentStage: firstDivergentStage(fp("M"), fp("M2")) } } : {}),
      };
      for (const run of Object.values(runs)) if (run.result) delete run.result.text;
      report.push(row);
      console.log("DETERMINISM-CASE", JSON.stringify({ case: row.case, conclusive: row.conclusive, comparisons: row.comparisons }));
    }
    const conclusive = report.filter(r => r.conclusive);
    const sum = (pick: (r: Record<string, unknown>) => number) => conclusive.reduce((n, r) => n + pick(r), 0);
    const c = (r: Record<string, unknown>) => r.comparisons as Record<string, Record<string, number | string | null | boolean>>;
    const s = (r: Record<string, unknown>) => r.schedules as Record<string, { exact: boolean; edits: number; referenceCharacters: number; status: string; candidate: boolean }>;
    const totals = Object.fromEntries(["A", "A2", "T", "P", "D1", "G"].map(name => [name, {
      exact: sum(r => +s(r)[name].exact), edits: sum(r => s(r)[name].edits), characters: sum(r => s(r)[name].referenceCharacters),
      candidates: sum(r => +s(r)[name].candidate), qualityRejected: sum(r => +(s(r)[name].status === "quality-rejected")) }]));
    const summary = {
      kind: "Licensed FSboard RGB frames through the production CPU tracking worker in lockstep; exposed regression clips; determinism and schedule sensitivity, not accuracy or webcam evidence",
      cases: report.length, conclusiveCases: conclusive.length,
      repeat: { frames: sum(r => c(r).repeat.compared as number), identical: sum(r => c(r).repeat.identical as number), divergentStageCounts: tally(conclusive.map(r => c(r).repeat.firstDivergentStage)) },
      timestampJitter: { frames: sum(r => c(r).timestampJitter.compared as number), identical: sum(r => c(r).timestampJitter.identical as number), maxLandmarkDelta: Math.max(0, ...conclusive.map(r => c(r).timestampJitter.maxLandmarkDelta as number)), divergentStageCounts: tally(conclusive.map(r => c(r).timestampJitter.firstDivergentStage)) },
      phaseShift: { sameOutput: sum(r => +(c(r).phaseShift.sameOutput as boolean)), divergentStageCounts: tally(conclusive.map(r => c(r).phaseShift.firstDivergentStage)) },
      singleDrop: { framesAfterDrop: sum(r => c(r).singleDrop.compared as number), identicalAfterDrop: sum(r => c(r).singleDrop.identical as number), maxLandmarkDelta: Math.max(0, ...conclusive.map(r => c(r).singleDrop.maxLandmarkDelta as number)), sameOutput: sum(r => +(c(r).singleDrop.sameOutput as boolean)) },
      interruptionStatus: tally(conclusive.map(r => c(r).interruption.status)),
      mirroredRepeat: { frames: sum(r => (c(r).mirroredRepeat?.compared as number) ?? 0), identical: sum(r => (c(r).mirroredRepeat?.identical as number) ?? 0) },
      recognitionBySchedule: totals,
    };
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify({ summary, cases: report }, null, 1));
    console.log("DETERMINISM-SUMMARY", JSON.stringify(summary));
  } finally { await session.release(); await browser.close(); server.close(); }
}
function tally(values: unknown[]) { const t: Record<string, number> = {}; for (const v of values) t[String(v)] = (t[String(v)] ?? 0) + 1; return t; }

if (process.argv[1]?.includes("tracking-determinism-rgb")) await main();
