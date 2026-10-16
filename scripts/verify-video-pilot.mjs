// Fail closed: a successful browser command is not proof that all six videos
// were evaluated. This historical pilot cannot be treated as a new holdout.
import { readFileSync } from "node:fs";
import { validateTrials, summarizeTrials } from "./evaluation-metrics.mjs";

export function verifyPilot(manifest, base, candidate) {
  if (!Array.isArray(manifest) || manifest.length !== 6) throw new Error("Expected six frozen historical pilot recordings");
  const expected = new Map(manifest.map(item => [item.trial_id, item]));
  if (expected.size !== manifest.length) throw new Error("Pilot manifest has duplicate IDs");
  const groups = [];
  for (const [label, rows] of [["base", base], ["candidate", candidate]]) {
    const trials = validateTrials(rows);
    if (trials.length !== expected.size) throw new Error(`${label}: incomplete pilot: ${trials.length}/${expected.size} trials`);
    for (const row of trials) {
      const original = expected.get(row.trial_id);
      if (!original || row.recording_sha256 !== original.recording_sha256
        || row.participant_id !== original.participant_id
        || row.expected_gloss !== original.expected_gloss
        || row.trial_type !== "sign"
        || row.capture_mode !== "unique-decoded-source-frames") {
        throw new Error(`${label}: mismatched or unexpected trial ${row.trial_id}`);
      }
      if (row.status !== "complete" || row.errors?.length) {
        throw new Error(`${label}: failed or partial trial ${row.trial_id}`);
      }
      if (!row.tasks_version || !row.worker_sha256 || row.analyses !== row.frames) {
        throw new Error(`${label}: missing runtime evidence or frame acknowledgements ${row.trial_id}`);
      }
    }
    groups.push(summarizeTrials(trials));
  }
  for (const row of base) {
    const other = candidate.find(trial => trial.trial_id === row.trial_id);
    for (const key of ["tasks_version", "input_mirrored", "preview_mirrored", "model_mapping", "source_duration_s"]) {
      if (row[key] !== other[key]) throw new Error(`Pair changed ${key} for ${row.trial_id}`);
    }
  }
  return { diagnostic_only: true, new_holdout: false,
    note: "Six previously inspected, publisher-labelled isolated signs; not fresh or independent new evidence. No idle/OOV negative trials.",
    base: groups[0], candidate: groups[1] };
}

if (process.argv[1] && import.meta.url === new URL("file://" + process.argv[1]).href) {
  const [before, after] = process.argv.slice(2);
  if (!before || !after) throw new Error("Usage: node scripts/verify-video-pilot.mjs base.jsonl candidate.jsonl");
  const parse = file => readFileSync(file, "utf8").trim().split(/\r?\n/).map(line => JSON.parse(line));
  const report = verifyPilot(JSON.parse(readFileSync("docs/evaluation/popsign-project-holdout-manifest.json", "utf8")),
    parse(before), parse(after));
  console.log(JSON.stringify(report));
}
