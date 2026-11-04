// Remove research-only fingerspelling assets from an export whose release flag
// is off (lib/release-flags.mjs). Notices stay so licence links still resolve.
import { readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { FINGERSPELLING_ASSETS, RESEARCH_EXPORT_MARKER, assertReleaseSafe, resolveFingerspelling, resolveStarterOutput } from "../lib/release-flags.mjs";

export async function pruneResearch(root, flag = resolveFingerspelling()) {
  if (flag === "on") return { flag, removed: [] };
  const { modelDir, workers, keptNotices } = FINGERSPELLING_ASSETS;
  const models = (await readdir(join(root, modelDir)).catch(() => [])).filter(name => !keptNotices.has(name)).map(name => join(modelDir, name));
  const removed = [];
  for (const target of [...models, ...workers.map(file => join("workers", file))]) {
    if (await stat(join(root, target)).catch(() => null)) { await rm(join(root, target), { recursive: true, force: true }); removed.push(target); }
  }
  return { flag, removed };
}

/** Why an export is research-only (empty for a public export).
 * @param {Record<string, string | undefined>} env */
export function researchReasons(env = process.env) {
  const reasons = [];
  if (resolveStarterOutput(env) === "auto") reasons.push("starter-rule words are inserted automatically (unvalidated)");
  if (resolveFingerspelling(env) === "on") reasons.push("research fingerspelling is included");
  if (env.NEXT_PUBLIC_SIGNRELAY_PROFILE === "rehearsal") reasons.push("automated rehearsal hook");
  return reasons;
}

/** @param {string} root @param {Record<string, string | undefined>} [env] */
export async function markResearchExport(root, env = process.env) {
  const reasons = researchReasons(env);
  if (reasons.length) await writeFile(join(root, RESEARCH_EXPORT_MARKER), `Research export - do not deploy publicly.\n${reasons.map(r => `- ${r}`).join("\n")}\n`);
  else await rm(join(root, RESEARCH_EXPORT_MARKER), { force: true });
  return reasons;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Also guards builds that skip prepare-export (the Vercel build command).
  assertReleaseSafe(process.env);
  const result = await pruneResearch(process.argv[2] ?? "out");
  const reasons = await markResearchExport(process.argv[2] ?? "out");
  if (reasons.length) console.warn(`Research export (marked ${RESEARCH_EXPORT_MARKER}; never deploy): ${reasons.join("; ")}.`);
  console.log(`Fingerspelling ${result.flag}: removed ${result.removed.length} research asset paths (${result.removed.join(", ") || "none"}).`);
}
