// Retrospective triage of ALREADY-INSPECTED aggregate development reports.
// No raw video/landmarks/holdouts are opened and no recognition is rerun.
import { readFile } from "node:fs/promises";
import { triageAslAbstention } from "./asl-observation-triage.mjs";

const sources = [
  "docs/evaluation/asl-miss-diagnosis-2026-10-17/historical-trace-report.json",
  "docs/evaluation/asl-miss-diagnosis-2026-10-17/development-trace-report.json",
];
const all = [];
for (const source of sources) {
  const snapshot = JSON.parse(await readFile(source, "utf8"));
  if (snapshot.diagnostic_only !== true || !Array.isArray(snapshot.trials))
    throw new Error("Only verified aggregate development snapshots can be triaged");
  all.push(...snapshot.trials);
}
if (all.length !== 11 || all.some(r => !r.trial_id || !r.recording_sha256 || !Array.isArray(r.accepted_glosses)))
  throw new Error("Frozen eleven-clip development aggregate changed");
const abstentions = all.filter(r => !r.accepted_glosses.length).map(r => ({
  trial_id: r.trial_id,
  expected_gloss: r.expected_gloss,
  existing_hand_frames: r.valid_hand_frames,
  existing_eligible_endpoints: r.starter_tracking_eligible_endpoints,
  ...triageAslAbstention(r),
}));
if (abstentions.length !== 6) throw new Error("Expected six already-known development abstentions");
const counts = Object.fromEntries([...new Set(abstentions.map(r => r.primary_observation))].sort()
  .map(key => [key, abstentions.filter(r => r.primary_observation === key).length]));
console.log(JSON.stringify({
  scope: "retrospective-publisher-labelled-development-only",
  source_date: "2026-10-17",
  new_recordings: 0,
  newly_measured_hand_episodes: false,
  seen_development_clips: all.length,
  abstentions: abstentions.length,
  grouping: counts,
  limitations: "Review leads derived from prior aggregate counters, not independently annotated signer strokes or new runtime accuracy. Holdouts untouched.",
  trials: abstentions,
}, null, 2));
