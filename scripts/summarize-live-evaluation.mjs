import { readFileSync } from "node:fs";

const input = process.argv[2];
if (!input) {
  console.error("Usage: npm run eval:live -- <results.jsonl>");
  process.exit(2);
}

const lines = readFileSync(input, "utf8")
  .split(/\r?\n/)
  .map(line => line.trim())
  .filter(Boolean);

if (!lines.length) {
  console.error("No evaluation trials found.");
  process.exit(2);
}

const required = ["session_id", "participant_id", "language", "trial_type", "expected_gloss", "predicted_gloss", "accepted"];
const rows = lines.map((line, index) => {
  let row;
  try {
    row = JSON.parse(line);
  } catch {
    throw new Error(`Line ${index + 1} is not valid JSON`);
  }

  for (const key of required) {
    if (!(key in row)) throw new Error(`Line ${index + 1} is missing ${key}`);
  }
  if (!["sign", "no_sign"].includes(row.trial_type)) {
    throw new Error(`Line ${index + 1} has invalid trial_type`);
  }
  if (typeof row.accepted !== "boolean") {
    throw new Error(`Line ${index + 1} accepted must be boolean`);
  }
  return row;
});

const byLanguage = new Map();
for (const row of rows) {
  if (!byLanguage.has(row.language)) byLanguage.set(row.language, []);
  byLanguage.get(row.language).push(row);
}

function pct(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : "n/a";
}

for (const [language, trials] of [...byLanguage.entries()].sort()) {
  const signed = trials.filter(row => row.trial_type === "sign");
  const noSign = trials.filter(row => row.trial_type === "no_sign");
  const acceptedSigned = signed.filter(row => row.accepted);
  const correct = signed.filter(row => row.accepted && row.predicted_gloss === row.expected_gloss);
  const wrongAccept = signed.filter(row => row.accepted && row.predicted_gloss !== row.expected_gloss);
  const falseAccept = noSign.filter(row => row.accepted);

  console.log(`\n${language}`);
  console.log(`  signed trials: ${signed.length}`);
  console.log(`  signed-trial accuracy: ${pct(correct.length / signed.length)}`);
  console.log(`  coverage (accepted signs): ${pct(acceptedSigned.length / signed.length)}`);
  console.log(`  precision when accepted: ${pct(correct.length / acceptedSigned.length)}`);
  console.log(`  wrong accepted signs: ${wrongAccept.length}`);
  console.log(`  no-sign false accept rate: ${pct(falseAccept.length / noSign.length)} (${falseAccept.length}/${noSign.length})`);

  const confusions = new Map();
  for (const row of wrongAccept) {
    const key = `${row.expected_gloss} -> ${row.predicted_gloss}`;
    confusions.set(key, (confusions.get(key) ?? 0) + 1);
  }
  const top = [...confusions.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  if (top.length) {
    console.log("  top confusions:");
    for (const [pair, count] of top) console.log(`    ${count}x ${pair}`);
  }
}
