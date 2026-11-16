#!/usr/bin/env node
// Side-by-side summary of video replays of the same development recordings:
//   node scripts/diagnostics/summarize-replays.mjs label=file.jsonl [label=file.jsonl ...]
// Aggregate counts only (no media, no landmarks). Development diagnostics: the
// clips are previously inspected, so nothing here is an accuracy estimate.
import { existsSync, readFileSync } from "node:fs";

const sources = process.argv.slice(2).map(arg => { const [label, ...rest] = arg.split("="); return { label, file: rest.join("=") }; });
if (!sources.length) { console.error("Usage: summarize-replays.mjs label=file.jsonl [...]"); process.exit(2); }
const DEMO = ["HELLO", "THANK YOU", "PLEASE", "SORRY", "YES", "NO"];
const out = { scope: "Previously inspected development clips. Not an accuracy estimate.", variants: [] };
for (const { label, file } of sources) {
  if (!existsSync(file)) { out.variants.push({ label, error: "replay did not produce a file" }); continue; }
  const rows = readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
  const trials = rows.map(row => {
    const accepted = row.accepted_glosses ?? [];
    const outcome = row.status !== "complete" ? "error" : !accepted.length ? "abstained"
      : accepted.every(gloss => gloss === row.expected_gloss) ? "correct" : "wrong";
    return { trial: row.trial_id, expected: row.expected_gloss, outcome, accepted, suggested: row.suggested_glosses ?? [],
      hand_frames: row.hand_frames ?? null, frames: row.frames ?? null,
      ready_analyses: row.motion_reasons?.ready ?? 0, ready_by_departure: row.motion_reasons?.["detail:departure"] ?? 0,
      ready_by_rest: row.motion_reasons?.["detail:rest"] ?? 0, reacquisition: row.hand_reacquisition ?? null };
  });
  const count = outcome => trials.filter(trial => trial.outcome === outcome).length;
  out.variants.push({ label, tracker: rows[0]?.tracker_variant ?? "production", worker_sha256: rows[0]?.worker_sha256 ?? null,
    trials: trials.length, correct: count("correct"), wrong: count("wrong"), abstained: count("abstained"), errors: count("error"),
    hand_frames: trials.reduce((sum, trial) => sum + (trial.hand_frames ?? 0), 0), frames: trials.reduce((sum, trial) => sum + (trial.frames ?? 0), 0),
    clips_with_a_ready_segment: trials.filter(trial => trial.ready_analyses > 0).length,
    suggestions: trials.reduce((sum, trial) => sum + trial.suggested.length, 0),
    suggestions_matching_label: trials.reduce((sum, trial) => sum + trial.suggested.filter(gloss => gloss === trial.expected).length, 0),
    by_demo_sign: Object.fromEntries(DEMO.map(gloss => {
      const own = trials.filter(trial => trial.expected === gloss);
      const elsewhere = trials.filter(trial => trial.expected !== gloss && trial.accepted.includes(gloss));
      return [gloss, { clips: own.length, correct: own.filter(trial => trial.outcome === "correct").length,
        wrong: own.filter(trial => trial.outcome === "wrong").length, abstained: own.filter(trial => trial.outcome === "abstained").length,
        produced_on_other_clips: elsewhere.length }];
    }).filter(([, value]) => value.clips || value.produced_on_other_clips)),
    other_sign_clips: (() => {
      const other = trials.filter(trial => !DEMO.includes(trial.expected));
      const words = {};
      for (const trial of other) for (const gloss of trial.accepted) words[gloss] = (words[gloss] ?? 0) + 1;
      return { clips: other.length, clips_with_a_wrong_word: other.filter(trial => trial.accepted.length).length, wrong_words: words,
        suggestions: other.reduce((sum, trial) => sum + trial.suggested.length, 0),
        suggestions_matching_label: other.reduce((sum, trial) => sum + trial.suggested.filter(gloss => gloss === trial.expected).length, 0) };
    })(),
    per_trial: trials.length <= 30 ? trials : undefined });
}
console.log(JSON.stringify(out, null, 1));
for (const variant of out.variants) {
  if (variant.error) { console.log(`${variant.label}: ${variant.error}`); continue; }
  console.log(`\n== ${variant.label} (tracker ${variant.tracker}): ${variant.correct} correct, ${variant.wrong} wrong, ${variant.abstained} abstained, ${variant.errors} errors; hands ${variant.hand_frames}/${variant.frames}; ready on ${variant.clips_with_a_ready_segment} clips; ${variant.suggestions} suggestions (${variant.suggestions_matching_label} matching)`);
  for (const [gloss, value] of Object.entries(variant.by_demo_sign)) console.log(`  ${gloss.padEnd(10)} ${value.correct}/${value.clips} correct, ${value.wrong} wrong, ${value.abstained} abstained; produced on ${value.produced_on_other_clips} other clips`);
  if (variant.other_sign_clips.clips) console.log(`  other signs: ${variant.other_sign_clips.clips_with_a_wrong_word}/${variant.other_sign_clips.clips} clips got a wrong word ${JSON.stringify(variant.other_sign_clips.wrong_words)}; ${variant.other_sign_clips.suggestions} suggestions (${variant.other_sign_clips.suggestions_matching_label} matching)`);
  for (const trial of variant.per_trial ?? []) console.log(`  ${String(trial.trial).padEnd(30)} ${String(trial.expected).padEnd(10)} ${trial.outcome.padEnd(9)} hands ${trial.hand_frames}/${trial.frames} ready ${trial.ready_analyses} (rest ${trial.ready_by_rest}, departure ${trial.ready_by_departure}) accepted [${trial.accepted.join(", ")}] suggested [${trial.suggested.join(", ")}]`);
}
