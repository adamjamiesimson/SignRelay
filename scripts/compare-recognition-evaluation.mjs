import { readFileSync } from "node:fs";
import { summarizeTrials, validateTrials } from "./evaluation-metrics.mjs";
const [before, after] = process.argv.slice(2);
if (!before || !after) throw new Error("Supply baseline.jsonl and candidate.jsonl");
const load = file => validateTrials(readFileSync(file, "utf8").split(/\r?\n/).filter(line => line.trim()).map(JSON.parse));
const a = load(before), b = load(after), byId = new Map(b.map(row => [row.trial_id, row]));
if (a.length !== b.length) throw new Error("Comparison must contain the same trials");
const changes = [];
for (const row of a) {
  const candidate = byId.get(row.trial_id);
  if (!candidate) throw new Error("Missing trial in candidate");
  for (const key of ["recording_sha256", "tasks_version", "input_mirrored", "preview_mirrored", "model_mapping", "capture_mode", "expected_gloss", "trial_type", "participant_id", "language", "evaluation_split"]) {
    if (row[key] === undefined || row[key] !== candidate[key]) throw new Error(`Comparison differs in ${key}: ${row.trial_id}`);
  }
  // Legacy reports used tasks_version for the WASM URL only. New reports
  // must carry both versions on each side; mixing legacy/new is not parity.
  for (const key of ["tasks_js_version", "tasks_wasm_version", "frame_stepper"]) {
    if (row[key] !== candidate[key]) throw new Error(`Comparison differs in ${key}: ${row.trial_id}`);
  }
  if (JSON.stringify(row.accepted_glosses) !== JSON.stringify(candidate.accepted_glosses)) {
    changes.push({ trial_id: row.trial_id, expected: row.expected_gloss, before: row.accepted_glosses, after: candidate.accepted_glosses });
  }
}
console.log(JSON.stringify({ diagnostic_only: true, paired_trials: a.length, baseline: summarizeTrials(a), candidate: summarizeTrials(b), changes }, null, 2));
