import { readFileSync } from "node:fs";
import { summarizeTrials } from "./evaluation-metrics.mjs";
const input = process.argv[2];
if (!input) throw new Error("Usage: npm run eval:live -- results.jsonl");
const rows = readFileSync(input, "utf8").split(/\r?\n/).filter(line => line.trim()).map(JSON.parse);
console.log(JSON.stringify({ diagnostic_only: true, counts_all_confirmations: true,
  note: "Declared splits are reported separately. Independent signer/training separation is not automatically verified.",
  groups: summarizeTrials(rows) }, null, 2));
