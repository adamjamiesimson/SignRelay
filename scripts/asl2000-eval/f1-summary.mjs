// F1 before/after summary of a browser replay (browser-run.mjs log, JSON lines).
// For each worker: what entered the transcript AUTOMATICALLY (confirmed), split
// by source and by whether the word matches the clip's gloss, what was only
// offered as a suggestion, and how many clips ended with no automatic word.
// Gloss text only; no media, frames or landmarks.
//   node scripts/asl2000-eval/f1-summary.mjs <clips.json> <worker-log.jsonl> [out.json]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const [clipsPath, logPath, out] = process.argv.slice(2);
const gloss = new Map(JSON.parse(readFileSync(clipsPath, "utf8")).map(c => [c.id, String(c.gloss).toUpperCase()]));
const rows = readFileSync(logPath, "utf8").split("\n").filter(line => line.startsWith("{")).map(line => JSON.parse(line)).filter(r => r.clip);
const byWorker = {};
for (const row of rows) {
  const w = byWorker[row.worker] ??= { clips: 0, errors: 0, auto: { total: 0, correct: 0, wrong: 0, bySource: {} }, suggested: { total: 0, correct: 0, wrong: 0 },
    clipsWithAutoWord: 0, clipsWithoutAutoWord: 0, clipsWithCorrectAutoWord: 0, clipsWithWrongAutoWord: 0 };
  w.clips++;
  if (row.error) w.errors++;
  const target = gloss.get(row.clip);
  const auto = (row.confirmed ?? []).map(entry => entry.split("/"));
  const offered = (row.suggested ?? []);
  for (const [word, source] of auto) {
    w.auto.total++; w.auto.bySource[source] = (w.auto.bySource[source] ?? 0) + 1;
    if (word.toUpperCase() === target) w.auto.correct++; else w.auto.wrong++;
  }
  for (const word of offered) { w.suggested.total++; if (String(word).toUpperCase() === target) w.suggested.correct++; else w.suggested.wrong++; }
  if (auto.length) w.clipsWithAutoWord++; else w.clipsWithoutAutoWord++;
  if (auto.some(([word]) => word.toUpperCase() === target)) w.clipsWithCorrectAutoWord++;
  if (auto.some(([word]) => word.toUpperCase() !== target)) w.clipsWithWrongAutoWord++;
}
const summary = { kind: "WLASL frozen-sample direct clips (C-UDA) through the production VisionEngine and each recognition worker in headless Chrome, CPU; exposed evaluation clips, not independent signers; gloss match against the clip label",
  workers: byWorker };
// Print first, so the counts survive even if the file cannot be written.
console.log("F1-RECORDED-SUMMARY", JSON.stringify(summary));
if (out) { mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, JSON.stringify(summary, null, 1)); }
