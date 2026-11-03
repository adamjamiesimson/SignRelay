// Remove research-only fingerspelling assets from an export whose release flag
// is off (lib/release-flags.mjs). Notices stay so licence links still resolve.
import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { FINGERSPELLING_ASSETS, resolveFingerspelling } from "../lib/release-flags.mjs";

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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await pruneResearch(process.argv[2] ?? "out");
  console.log(`Fingerspelling ${result.flag}: removed ${result.removed.length} research asset paths (${result.removed.join(", ") || "none"}).`);
}
