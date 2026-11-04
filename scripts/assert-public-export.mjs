// Last gate before anything is deployed publicly (scripts/deploy-firebase.sh).
// Inspects the export ARTIFACT, not the environment, and refuses any export
// that could insert unvalidated words automatically or that carries research
// or private tooling:
//   - a research-export marker (lib/release-flags.mjs RESEARCH_EXPORT_MARKER);
//   - the private capture or study routes, or their marker;
//   - a runtime manifest that is missing, not the production ("full") profile,
//     or records automatic starter-rule words, fingerspelling or the
//     rehearsal hook;
//   - compiled client code containing the automatic-starter research banner or
//     the fingerspelling workspace.
//   node scripts/assert-public-export.mjs [out]
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { FINGERSPELLING_UI_MARKERS, RESEARCH_EXPORT_MARKER, STARTER_AUTO_UI_MARKER } from "../lib/release-flags.mjs";
import { PRIVATE_EXPORT_MARKER, PRIVATE_ROUTES } from "./exclude-private-routes.mjs";

function scripts(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? scripts(join(dir, entry.name))
    : entry.name.endsWith(".js") ? [join(dir, entry.name)] : []);
}

export function publicExportProblems(root = "out") {
  const problems = [];
  if (!existsSync(join(root, "index.html"))) return [`${root}/index.html is missing: not a complete export`];
  if (existsSync(join(root, RESEARCH_EXPORT_MARKER))) problems.push(`research export marker present (${readFileSync(join(root, RESEARCH_EXPORT_MARKER), "utf8").trim().replace(/\n/g, " ")})`);
  if (existsSync(join(root, PRIVATE_EXPORT_MARKER))) problems.push("private capture marker present");
  for (const route of PRIVATE_ROUTES) for (const target of [route, `${route}.html`])
    if (existsSync(join(root, target))) problems.push(`private route /${route} is included`);
  const manifestPath = join(root, "runtime-manifest.json");
  if (!existsSync(manifestPath)) problems.push("runtime-manifest.json is missing (verify-runtime did not run)");
  else {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (manifest.profile !== "full") problems.push(`profile is ${manifest.profile}, not the production profile "full"`);
    if (manifest.starter_output !== "suggest") problems.push(`starter_output is ${JSON.stringify(manifest.starter_output)}, not "suggest"`);
    if (manifest.fingerspelling !== "off") problems.push(`fingerspelling is ${JSON.stringify(manifest.fingerspelling)}, not "off"`);
    if (manifest.rehearsal_hook) problems.push("the automated rehearsal hook is included");
  }
  const code = scripts(join(root, "_next"));
  if (!code.length) problems.push("no compiled client code found");
  const text = code.map(file => readFileSync(file, "utf8"));
  if (text.some(t => t.includes(STARTER_AUTO_UI_MARKER))) problems.push("compiled client inserts starter-rule words automatically (research banner present)");
  if (FINGERSPELLING_UI_MARKERS.every(marker => text.some(t => t.includes(marker)))) problems.push("compiled client contains the research fingerspelling workspace");
  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = process.argv[2] ?? "out";
  const problems = publicExportProblems(root);
  if (problems.length) {
    console.error(`Refusing a public deployment of ${root}/:\n${problems.map(p => `  - ${p}`).join("\n")}\nRebuild with npm run build:firebase and no research switches.`);
    process.exit(1);
  }
  console.log(`${root}/ is a public production export: starter-rule and research-model words are suggestions; no research or private tooling.`);
}
