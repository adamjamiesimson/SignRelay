// Explicit collection step, never invoked by the evaluator or CI replay.
import { readFile, writeFile } from "node:fs/promises";
import { validateManifest, aslVocabulary, fingerprint } from "./evaluation-manifest.mjs";
const files = [
  ["docs/evaluation/popsign-project-holdout-manifest.json", "historical-development"],
  ["docs/evaluation/popsign-development-2026-10-16.json", "development"],
  ["docs/evaluation/popsign-reserved-holdout-2026-10-16.json", "sealed-holdout"],
];
const manifests = [], cohorts = [];
for (const [file, role] of files) {
  const bytes = await readFile(file), rows = JSON.parse(bytes);
  if (role === "historical-development") for (const row of rows) row.evaluation_split = "development";
  cohorts.push(rows); manifests.push({ file, role, sha256: fingerprint(bytes), recordings: rows.length });
}
const vocabulary = aslVocabulary();
validateManifest(cohorts.flat(), { allowHoldout: true, vocabulary });
await writeFile("docs/evaluation/cohort-lock-2026-10-16.json", JSON.stringify({
  schema: 1, manifests, vocabulary_sha256: vocabulary.sha256,
  note: "Frozen before final candidate comparison. Sealed cohort not decoded or predicted. Publisher labels; upstream training identity overlap unknown."
}, null, 2) + "\n");
console.log("Cohort fingerprints frozen; signer and recording separation validated.");
