// Replay captured landmark sequences (runner-local; produced by browser-run.mjs)
// through the production recognition worker under starter-rule variants.
// Research models are stubbed silent here, so every automatic word is a
// starter-rule (or personal) word; the live capture messages, recorded with the
// real models, are summarised separately. Prints and writes counts, glosses
// and rule measurements only: never frames or landmarks.
//   node scripts/asl2000-eval/starter-replay.mjs <clips.json> <captures-dir> <out.json>
import { build } from "esbuild";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [clipsPath, capturesDir, out] = process.argv.slice(2);
if (!clipsPath || !capturesDir || !out) throw new Error("usage: starter-replay.mjs <clips.json> <captures-dir> <out.json>");
const root = process.cwd();
mkdirSync("work/starter-replay", { recursive: true });
const STARTER_LIB = path.join(root, "lib/asl-starter-recognition.ts");
const silent = "export async function stub() { return null; }";
// Diagnostic bundle only: route the worker's starter analysis through
// globalThis.__STARTER_OPTIONS__ and silence every research model.
const plugin = { name: "starter-variants", setup(b) {
  b.onResolve({ filter: /^@\/lib\/(asl1000|bsl1064|isl263|lse300|psl776)-runtime$/ }, args => ({ path: args.path, namespace: "silent" }));
  b.onLoad({ filter: /.*/, namespace: "silent" }, () => ({ contents: `${silent}
    export const recognizeAsl1000 = stub, recognizeBsl1064 = stub, recognizeIsl263 = stub, recognizeLse300 = stub, recognizePsl776 = stub;`, loader: "js" }));
  b.onResolve({ filter: /^@\/lib\/asl-starter-recognition$/ }, args => args.importer.endsWith("recognition.worker.ts") ? { path: "variant", namespace: "variant" } : undefined);
  b.onLoad({ filter: /.*/, namespace: "variant" }, () => ({ resolveDir: root, loader: "js", contents: `
    import * as real from ${JSON.stringify(STARTER_LIB)};
    export * from ${JSON.stringify(STARTER_LIB)};
    export const analyzeAslStarter = frames => real.analyzeAslStarter(frames, globalThis.__STARTER_OPTIONS__ ?? {});` }));
} };
await build({ entryPoints: ["workers/recognition.worker.ts"], bundle: true, format: "esm", platform: "neutral", target: "es2022",
  outfile: "work/starter-replay/worker.mjs", plugins: [plugin], alias: { "@": root }, logLevel: "error", mainFields: ["module", "main"] });
await build({ entryPoints: ["lib/asl-starter-recognition.ts"], bundle: true, format: "esm", platform: "neutral", outfile: "work/starter-replay/starter.mjs", alias: { "@": root }, logLevel: "error" });
const { starterDiagnostics } = await import(pathToFileURL(path.resolve("work/starter-replay/starter.mjs")).href);

export const VARIANTS = {
  baseline: {},
  thankYouForward: { thankYouForward: true },
  endAboveRest: { endAboveRest: true },
  helloFromForehead: { helloFromForehead: true },
  settledEnding: { settledEnding: true },
  "endAboveRest+settledEnding": { endAboveRest: true, settledEnding: true },
  "endAboveRest+thankYouForward": { endAboveRest: true, thankYouForward: true },
  "helloFromForehead+thankYouForward": { helloFromForehead: true, thankYouForward: true },
  all: { thankYouForward: true, endAboveRest: true, helloFromForehead: true, settledEnding: true },
};
// The nested personal matcher is not exercised (no templates); a no-op Worker keeps it constructible.
globalThis.Worker = class { postMessage() {} terminate() {} };

async function replayer(variant) {
  const port = { onmessage: null, posted: [], postMessage(message) { this.posted.push(message); } };
  globalThis.self = port;
  globalThis.__STARTER_OPTIONS__ = VARIANTS[variant];
  await import(pathToFileURL(path.resolve("work/starter-replay/worker.mjs")).href + `?variant=${encodeURIComponent(variant)}`);
  return async frames => {
    globalThis.self = port; globalThis.__STARTER_OPTIONS__ = VARIANTS[variant];
    port.posted = [];
    await port.onmessage({ data: { type: "templates", language: "asl", templates: [] } });
    const events = [];
    for (const [index, frame] of frames.entries()) {
      const before = port.posted.length;
      await port.onmessage({ data: { type: "frame", frame } });
      await Promise.resolve();
      for (const message of port.posted.slice(before)) if (message.type === "confirmed") events.push({ word: message.gloss, source: message.source, index, ms: frame.timestamp - frames[0].timestamp });
    }
    return events;
  };
}

const clips = new Map(JSON.parse(readFileSync(clipsPath, "utf8")).map(c => [c.id, c]));
const captures = readdirSync(capturesDir).filter(name => name.endsWith(".json")).map(name => JSON.parse(readFileSync(path.join(capturesDir, name), "utf8")))
  .filter(capture => clips.has(capture.id) && capture.frames?.length);
const runners = {};
for (const variant of Object.keys(VARIANTS)) runners[variant] = await replayer(variant);

const rows = [];
for (const capture of captures) {
  const clip = clips.get(capture.id);
  const row = { clip: clip.id, set: clip.set, gloss: clip.gloss, frames: capture.frames.length,
    live: { confirmed: (capture.messages ?? []).filter(m => m.type === "confirmed").map(m => `${m.gloss}/${m.source}`),
      suggested: (capture.messages ?? []).filter(m => m.type === "suggested").map(m => m.gloss) }, variants: {} };
  for (const variant of Object.keys(VARIANTS)) row.variants[variant] = await runners[variant](capture.frames);
  // Rule measurements for every baseline starter word (the window it fired in).
  row.diagnostics = row.variants.baseline.filter(e => e.source === "starter").map(e => ({ word: e.word, ms: e.ms,
    windows: starterDiagnostics(capture.frames.slice(0, e.index + 1)).filter(w => w.label === e.word) }));
  rows.push(row);
  console.log("STARTER-CLIP", JSON.stringify({ clip: row.clip, set: row.set, gloss: row.gloss, live: row.live,
    variants: Object.fromEntries(Object.entries(row.variants).map(([k, v]) => [k, v.map(e => `${e.word}@${e.ms}`)])), diagnostics: row.diagnostics }));
}

function summarise(set) {
  const inSet = rows.filter(r => r.set === set);
  const positive = set.endsWith("positive");
  const result = { clips: inSet.length };
  for (const variant of Object.keys(VARIANTS)) {
    const s = { auto_words: 0, correct: 0, false: 0, clips_with_false: 0, clips_with_correct: 0, abstained: 0, false_by_word: {}, recall_by_gloss: {}, first_correct_ms: [] };
    for (const r of inSet) {
      const events = r.variants[variant];
      s.auto_words += events.length;
      const correct = events.filter(e => e.word === r.gloss), wrong = events.filter(e => e.word !== r.gloss);
      s.correct += correct.length; s.false += wrong.length;
      if (wrong.length) s.clips_with_false++;
      if (correct.length) { s.clips_with_correct++; s.first_correct_ms.push(correct[0].ms); }
      if (!events.length) s.abstained++;
      for (const e of wrong) s.false_by_word[e.word] = (s.false_by_word[e.word] ?? 0) + 1;
      if (positive) { const g = (s.recall_by_gloss[r.gloss] ??= { clips: 0, recognised: 0 }); g.clips++; if (correct.length) g.recognised++; }
    }
    const sorted = [...s.first_correct_ms].sort((a, b) => a - b);
    s.first_correct_ms = sorted.length ? { median: sorted[Math.floor(sorted.length / 2)], p90: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))] } : null;
    result[variant] = s;
  }
  // The live capture used the PR #54 worker with the real research models.
  result.live_pr54 = { auto_starter: inSet.reduce((n, r) => n + r.live.confirmed.filter(w => w.endsWith("/starter")).length, 0),
    auto_starter_correct: inSet.reduce((n, r) => n + r.live.confirmed.filter(w => w === `${r.gloss}/starter`).length, 0),
    model_suggestions: inSet.reduce((n, r) => n + r.live.suggested.length, 0),
    model_suggestions_correct: inSet.reduce((n, r) => n + r.live.suggested.filter(w => w === r.gloss).length, 0),
    other_auto: inSet.reduce((n, r) => n + r.live.confirmed.filter(w => !w.endsWith("/starter")).length, 0) };
  return result;
}
const summary = { kind: "WLASL direct clips (C-UDA) captured once with the production VisionEngine in headless Chrome; starter-rule variants replayed through the production worker with research models silent; live = PR #54 worker with real models during capture. Counts, glosses and rule measurements only.",
  sets: Object.fromEntries(["exposed-negative", "heldout-negative", "dev-positive", "heldout-positive"].map(set => [set, summarise(set)])) };
console.log("STARTER-SUMMARY", JSON.stringify(summary));
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(summary, null, 1));
