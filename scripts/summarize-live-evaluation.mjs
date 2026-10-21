import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { summarizeTrials } from "./evaluation-metrics.mjs";

/** Unreviewed operator-log rows (scripts/live-trial-log.mjs) are summarised
 * apart from everything else, so they can never be read as reviewed results. */
export function summarizeLive(rows) {
  const unreviewed = row => row.source === "operator-live-log" && row.review?.status !== "reviewed";
  const operator = rows.filter(unreviewed), other = rows.filter(row => !unreviewed(row));
  return { diagnostic_only: true, counts_all_confirmations: true,
    note: "Declared splits are reported separately. Independent signer/training separation is not automatically verified.",
    groups: other.length ? summarizeTrials(other) : [],
    ...(operator.length ? { unreviewed_operator_observations: {
      note: "Live-demo operator observations. Not reviewed by a fluent signer, not accuracy, not for publication.",
      groups: summarizeTrials(operator) } } : {}) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const input = process.argv[2];
  if (!input) throw new Error("Usage: npm run eval:live -- results.jsonl");
  const rows = readFileSync(input, "utf8").split(/\r?\n/).filter(line => line.trim()).map(JSON.parse);
  console.log(JSON.stringify(summarizeLive(rows), null, 2));
}
