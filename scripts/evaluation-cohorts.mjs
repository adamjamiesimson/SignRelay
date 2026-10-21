import { readFile } from "node:fs/promises";
import path from "node:path";
import { fingerprint, validateManifest } from "./evaluation-manifest.mjs";
import { approveDevelopmentIntake } from "./reviewed-development.mjs";

export const canonicalLock = "docs/evaluation/cohort-lock-2026-10-16.json";

export async function loadFrozenCohorts(file = canonicalLock, vocabulary) {
  const original = JSON.parse(await readFile(canonicalLock, "utf8"));
  const registry = path.resolve(file) === path.resolve(canonicalLock) ? original : JSON.parse(await readFile(file, "utf8"));
  if (registry.vocabulary_sha256 !== vocabulary.sha256) throw new Error("Installed ASL vocabulary changed after cohort freeze");
  if (!Array.isArray(registry.manifests) || new Set(registry.manifests.map(item => path.resolve(item.file))).size !== registry.manifests.length)
    throw new Error("Cohort lock has missing or duplicate manifests");
  // A collection extension cannot discard or redefine reserved participants.
  for (const entry of original.manifests) {
    const found = registry.manifests.find(item => path.resolve(item.file) === path.resolve(entry.file));
    if (!found || ["role", "sha256", "recordings"].some(key => found[key] !== entry[key]))
      throw new Error("Extended lock must preserve every original cohort");
  }
  const cohorts = [];
  for (const entry of registry.manifests) {
    const bytes = await readFile(entry.file);
    if (fingerprint(bytes) !== entry.sha256) throw new Error("Cohort manifest changed after freezing");
    const rows = JSON.parse(bytes);
    if (rows.length !== entry.recordings) throw new Error("Cohort recording count differs from lock");
    if (entry.role === "historical-development") for (const row of rows) row.evaluation_split = "development";
    else if (entry.role === "reviewed-development") {
      if (entry.review_policy !== "independent-fluent-asl-v1" || !entry.collection_plan) throw new Error("Reviewed cohort needs its collection policy and plan");
      const planBytes = await readFile(entry.collection_plan);
      if (fingerprint(planBytes) !== entry.collection_plan_sha256) throw new Error("Collection plan changed after freezing");
      const plan = JSON.parse(planBytes);
      approveDevelopmentIntake({ plan_id: plan.plan_id,
        participants: [...new Map(rows.map(row => [row.participant_id, { participant_id: row.participant_id, dominant_hand: row.dominant_hand }])).values()],
        trials: rows.map(row => ({ ...row, review: row.independent_review })),
      }, plan, vocabulary);
    }
    else if (!["development", "sealed-holdout"].includes(entry.role)) throw new Error("Unknown cohort role");
    if (entry.role !== "sealed-holdout" && rows.some(row => row.evaluation_split !== "development")
      || entry.role === "sealed-holdout" && rows.some(row => row.evaluation_split !== "held_out")) throw new Error("Cohort role differs from declared split");
    cohorts.push({ ...entry, rows });
  }
  validateManifest(cohorts.flatMap(cohort => cohort.rows), { vocabulary, allowHoldout: true });
  return { registry, cohorts };
}
