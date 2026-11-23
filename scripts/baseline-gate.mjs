// Paired regression gate against the exact established baseline (not the
// frozen pre-PR28 worker). Every trial of the established result must be
// present and complete in the candidate run. A new wrong acceptance always
// fails. A lost correct outcome or any changed abstention fails unless
// docs/evaluation/baseline-change-explanations.json explains that exact
// trial, outcome and candidate worker. Development evidence only.
//
//   node scripts/baseline-gate.mjs candidate.jsonl [more.jsonl ...]
//   node scripts/baseline-gate.mjs --freeze rows.jsonl [...] > docs/evaluation/established-baseline.json
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { assertCohort } from "./evaluation-dashboard.mjs";

export const BASELINE = "docs/evaluation/established-baseline.json";
export const EXPLANATIONS = "docs/evaluation/baseline-change-explanations.json";

export function outcomeOf(row) {
  if (row.status !== "complete" || row.errors?.length) return "error";
  const accepted = row.accepted_glosses ?? [];
  if (!accepted.length) return "abstained";
  return accepted.every(gloss => gloss === row.expected_gloss) ? "correct" : "wrong";
}

export function freezeBaseline(rows, cohortLock) {
  assertCohort(rows, cohortLock, "baseline");
  const workers = [...new Set(rows.map(row => row.worker_sha256))];
  if (workers.length !== 1) throw new Error("An established baseline must come from exactly one worker");
  if (rows.some(row => outcomeOf(row) === "error")) throw new Error("An established baseline cannot contain failed trials");
  return { schema: 1, worker_sha256: workers[0], cohort_lock_vocabulary: cohortLock.vocabulary_sha256,
    trials: rows.map(row => ({ trial_id: row.trial_id, recording_sha256: row.recording_sha256, manifest_sha256: row.manifest_sha256,
      expected_gloss: row.expected_gloss, outcome: outcomeOf(row), accepted_glosses: row.accepted_glosses ?? [] }))
      .sort((a, b) => a.trial_id.localeCompare(b.trial_id)) };
}

/** @param {any} baseline @param {any[]} candidateRows
 * @param {{ changes: { trial_id: string, to: string, candidate_worker_sha256: string, explanation: string }[] }} [explanations]
 * @param {any} [cohortLock]
 * @returns {{ ok: boolean, failures: string[], changes: object[], explained: object[], candidate_worker: string | null }} */
export function gate(baseline, candidateRows, explanations = { changes: [] }, cohortLock = null) {
  const failures = [], changes = [], explained = [];
  if (cohortLock) assertCohort(candidateRows, cohortLock, "candidate");
  const workers = [...new Set(candidateRows.map(row => row.worker_sha256))];
  if (workers.length !== 1) failures.push(`Candidate rows come from ${workers.length} workers; run one worker at a time`);
  const worker = workers[0] ?? null;
  const byRecording = new Map(candidateRows.map(row => [row.recording_sha256, row]));
  if (byRecording.size !== candidateRows.length) failures.push("A recording appears more than once in the candidate run");
  const known = new Set(baseline.trials.map(trial => trial.recording_sha256));
  for (const row of candidateRows) if (!known.has(row.recording_sha256)) failures.push(`${row.trial_id} is not in the established baseline; extend the baseline deliberately, not in a candidate run`);
  for (const trial of baseline.trials) {
    const row = byRecording.get(trial.recording_sha256);
    if (!row) { failures.push(`Missing ${trial.trial_id}: every baseline trial must be re-run`); continue; }
    if (row.expected_gloss !== trial.expected_gloss) { failures.push(`${trial.trial_id}: expected gloss changed`); continue; }
    const now = outcomeOf(row);
    if (now === "error") { failures.push(`${trial.trial_id}: candidate trial failed or is partial; a failure is never an abstention`); continue; }
    const newWrong = (row.accepted_glosses ?? []).filter(gloss => gloss !== trial.expected_gloss && !trial.accepted_glosses.includes(gloss));
    if (newWrong.length) { failures.push(`NEW WRONG ACCEPTANCE on ${trial.trial_id}: ${trial.expected_gloss} -> ${newWrong.join(", ")} (cannot be explained away)`); continue; }
    if (now === trial.outcome && JSON.stringify(row.accepted_glosses ?? []) === JSON.stringify(trial.accepted_glosses)) continue;
    const kind = trial.outcome === "correct" ? "lost_correct" : trial.outcome === "abstained" && now === "correct" ? "abstention_to_correct" : `${trial.outcome}_to_${now}`;
    const change = { trial_id: trial.trial_id, kind, from: trial.outcome, to: now, accepted_glosses: row.accepted_glosses ?? [] };
    changes.push(change);
    if ([baseline.worker_sha256, ...(baseline.reproduced_by_workers ?? [])].includes(worker)) { failures.push(`${trial.trial_id} changed (${kind}) with the same worker as the baseline: nondeterministic evaluation`); continue; }
    const reason = explanations.changes.find(entry => entry.trial_id === trial.trial_id && entry.to === now && entry.candidate_worker_sha256 === worker && entry.explanation?.trim());
    if (reason) explained.push({ ...change, explanation: reason.explanation });
    else failures.push(`${trial.trial_id}: ${kind} (${trial.outcome} -> ${now}) needs an entry in ${EXPLANATIONS} for worker ${String(worker).slice(0, 12)}`);
  }
  return { ok: failures.length === 0, failures, changes, explained, candidate_worker: worker };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const freeze = args[0] === "--freeze";
  const files = freeze ? args.slice(1) : args;
  if (!files.length) throw new Error("Usage: node scripts/baseline-gate.mjs [--freeze] rows.jsonl [...]");
  const rows = files.flatMap(file => readFileSync(file, "utf8").trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)));
  const lock = JSON.parse(readFileSync("docs/evaluation/cohort-lock-2026-10-16.json", "utf8"));
  if (freeze) { console.log(JSON.stringify(freezeBaseline(rows, lock), null, 2)); process.exit(0); }
  const result = gate(JSON.parse(readFileSync(BASELINE, "utf8")), rows, JSON.parse(readFileSync(EXPLANATIONS, "utf8")), lock);
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
}
