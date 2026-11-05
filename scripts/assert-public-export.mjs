// Last gate for the Firebase and Vercel public artifacts.
// Inspects the export ARTIFACT, not the environment, and refuses any export
// that could insert unvalidated words automatically or that carries research
// or private tooling:
//   - a research-export marker (lib/release-flags.mjs RESEARCH_EXPORT_MARKER);
//   - private route payloads, research weights and workers, or their markers;
//   - a runtime manifest that is missing, not the production ("full") profile,
//     or records automatic starter-rule words, fingerspelling or the
//     rehearsal hook;
//   - compiled client code containing the automatic-starter research banner or
//     the fingerspelling workspace.
//   node scripts/assert-public-export.mjs [out]
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { FINGERSPELLING_UI_MARKERS, RESEARCH_EXPORT_MARKER, STARTER_AUTO_UI_MARKER } from "../lib/release-flags.mjs";
import { PRIVATE_EXPORT_MARKER, PRIVATE_ROUTES, privateRoutePaths } from "./exclude-private-routes.mjs";
import { researchAssetPaths } from "./prune-research.mjs";
import { currentSourceCommit, REHEARSAL_HOOK } from "./verify-runtime.mjs";

function scripts(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? scripts(join(dir, entry.name))
    : entry.name.endsWith(".js") ? [join(dir, entry.name)] : []);
}

/** @param {string} [root] @param {string | null} [sourceCommit] */
export function publicExportProblems(root = "out", sourceCommit = null) {
  const problems = [];
  if (!existsSync(join(root, "index.html"))) return [`${root}/index.html is missing: not a complete export`];
  if (existsSync(join(root, RESEARCH_EXPORT_MARKER))) problems.push(`research export marker present (${readFileSync(join(root, RESEARCH_EXPORT_MARKER), "utf8").trim().replace(/\n/g, " ")})`);
  if (existsSync(join(root, PRIVATE_EXPORT_MARKER))) problems.push("private capture marker present");
  for (const route of PRIVATE_ROUTES)
    if (privateRoutePaths(route).some(target => existsSync(join(root, target)))) problems.push(`private route /${route} is included`);
  for (const asset of researchAssetPaths(root)) problems.push(`research asset ${asset} is included`);
  const manifestPath = join(root, "runtime-manifest.json");
  if (!existsSync(manifestPath)) problems.push("runtime-manifest.json is missing (verify-runtime did not run)");
  else {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (manifest.profile !== "full") problems.push(`profile is ${manifest.profile}, not the production profile "full"`);
    if (manifest.starter_output !== "suggest") problems.push(`starter_output is ${JSON.stringify(manifest.starter_output)}, not "suggest"`);
    if (manifest.fingerspelling !== "off") problems.push(`fingerspelling is ${JSON.stringify(manifest.fingerspelling)}, not "off"`);
    if (manifest.rehearsal_hook !== false) problems.push("the manifest does not verify that the automated rehearsal hook is absent");
    if (sourceCommit && manifest.source_commit !== sourceCommit)
      problems.push("the export was not verified for the current source commit");
    const worker = join(root, "workers", "recognition.worker.js");
    if (!existsSync(worker) || createHash("sha256").update(readFileSync(worker)).digest("hex") !== manifest.recognition_worker_sha256)
      problems.push("the recognition worker is missing or differs from the verified runtime manifest");
  }
  const code = scripts(join(root, "_next"));
  if (!code.length) problems.push("no compiled client code found");
  const text = code.map(file => readFileSync(file, "utf8"));
  if (text.some(t => t.includes(STARTER_AUTO_UI_MARKER))) problems.push("compiled client inserts starter-rule words automatically (research banner present)");
  if (FINGERSPELLING_UI_MARKERS.every(marker => text.some(t => t.includes(marker)))) problems.push("compiled client contains the research fingerspelling workspace");
  if (text.some(t => t.includes(REHEARSAL_HOOK))) problems.push("compiled client contains the automated rehearsal hook");
  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = process.argv[2] ?? "out";
  const problems = publicExportProblems(root, currentSourceCommit());
  if (problems.length) {
    console.error(`Refusing a public deployment of ${root}/:\n${problems.map(p => `  - ${p}`).join("\n")}\nRebuild with npm run build:firebase and no research switches.`);
    process.exit(1);
  }
  console.log(`${root}/ is a public production export: starter-rule and research-model words are suggestions; no research or private tooling.`);
}
