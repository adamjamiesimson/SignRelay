// Explicit runtime-only experiment. Ordinary worker comparisons still require
// identical JS/WASM versions; this does not relax that separate evidence gate.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { TASKS_VERSION } from "../lib/vision-runtime.mjs";
import { summarizeTrials, validateTrials } from "./evaluation-metrics.mjs";

export function verifyRuntimeChange(manifest, before, after, baselineRuntime) {
  if (!baselineRuntime?.js || !baselineRuntime?.wasm
    || (baselineRuntime.js === TASKS_VERSION && baselineRuntime.wasm === TASKS_VERSION)) {
    throw new Error("Declare the different baseline JS/WASM pair for this runtime experiment");
  }
  const expected = new Map(manifest.map(row => [row.trial_id, row]));
  if (!expected.size || expected.size !== manifest.length) throw new Error("Invalid experiment manifest");
  const a = validateTrials(before), b = validateTrials(after);
  for (const [rows, runtime] of [[a, baselineRuntime], [b, { js: TASKS_VERSION, wasm: TASKS_VERSION }]]) {
    if (rows.length !== expected.size) throw new Error("Incomplete runtime comparison");
    for (const row of rows) {
      const fixture = expected.get(row.trial_id);
      if (!fixture || row.recording_sha256 !== fixture.recording_sha256
        || row.participant_id !== fixture.participant_id || row.language !== fixture.language
        || row.expected_gloss !== (fixture.expected_gloss ?? null) || row.trial_type !== fixture.trial_type
        || row.evaluation_split !== "development" || row.capture_mode !== "unique-decoded-source-frames") {
        throw new Error(`Mismatched development recording: ${row.trial_id}`);
      }
      if (row.status !== "complete" || !Array.isArray(row.errors) || row.errors.length
        || !Number.isInteger(row.frames) || row.frames <= 0
        || !Number.isInteger(row.analyses) || row.analyses <= 0 || row.analyses > row.frames
        || !Number.isInteger(row.hand_frames) || row.hand_frames < 0 || row.hand_frames > row.frames) {
        throw new Error(`Failed or incomplete runtime evidence: ${row.trial_id}`);
      }
      if (row.tasks_js_version !== runtime.js || row.tasks_wasm_version !== runtime.wasm
        || row.tasks_version !== runtime.wasm) throw new Error(`Unexpected runtime pair: ${row.trial_id}`);
    }
  }
  const byId = new Map(b.map(row => [row.trial_id, row])), changes = [], tracking = [];
  for (const row of a) {
    const other = byId.get(row.trial_id);
    if (row.frame_stepper !== other.frame_stepper) throw new Error(`Runtime experiment changed frame_stepper: ${row.trial_id}`);
    for (const key of ["worker_sha256", "manifest_sha256", "vocabulary_sha256", "input_mirrored", "preview_mirrored",
      "model_mapping", "source_duration_s", "frames"]) {
      if (row[key] === undefined || row[key] !== other[key]) throw new Error(`Runtime experiment changed ${key}: ${row.trial_id}`);
    }
    const oldWrong = new Set(row.accepted_glosses.filter(word => word !== row.expected_gloss));
    if (other.accepted_glosses.some(word => word !== other.expected_gloss && !oldWrong.has(word))) {
      throw new Error(`New wrong acceptance: ${row.trial_id}`);
    }
    const wasCorrect = row.accepted_glosses.length && row.accepted_glosses.every(word => word === row.expected_gloss);
    const isCorrect = other.accepted_glosses.length && other.accepted_glosses.every(word => word === other.expected_gloss);
    if (wasCorrect && !isCorrect) throw new Error(`Lost correct recognition: ${row.trial_id}`);
    if (JSON.stringify(row.accepted_glosses) !== JSON.stringify(other.accepted_glosses)) {
      changes.push({ trial_id: row.trial_id, before: row.accepted_glosses, after: other.accepted_glosses });
    }
    tracking.push({ trial_id: row.trial_id, frames: row.frames,
      before_hand_frames: row.hand_frames, after_hand_frames: other.hand_frames });
  }
  return { diagnostic_only: true, new_holdout: false, paired_trials: a.length,
    baseline_runtime: baselineRuntime, candidate_runtime: { js: TASKS_VERSION, wasm: TASKS_VERSION },
    baseline: summarizeTrials(a), candidate: summarizeTrials(b), changes, tracking };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [manifest, before, after, js, wasm] = process.argv.slice(2);
  if (!manifest || !before || !after || !js || !wasm) {
    throw new Error("Usage: node scripts/verify-vision-runtime-change.mjs manifest.json before.jsonl after.jsonl baseline-js baseline-wasm");
  }
  const load = file => readFileSync(file, "utf8").trim().split(/\r?\n/).map(JSON.parse);
  console.log(JSON.stringify(verifyRuntimeChange(JSON.parse(readFileSync(manifest, "utf8")), load(before), load(after), { js, wasm }), null, 2));
}
