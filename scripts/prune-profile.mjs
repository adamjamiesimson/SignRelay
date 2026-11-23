// Remove assets that a build profile does not support from out/. The ASL demo
// profile ships the ASL workspace only; other language models and their
// clip-mode workers are removed so the export cannot pretend to offer them.
// Their attribution and licence notices stay, so the linked notices still resolve.
import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ASL_V31_ASSET_PATH, ASL_V31_ASSET_PINS, ASL_V31_TRACKER_FILE } from "../lib/asl-v31-assets.mjs";
import { VISION_MODELS } from "../lib/vision-runtime.mjs";
import { KEPT_NOTICES, NON_ASL_MODEL_DIRS, NON_ASL_WORKERS } from "./verify-runtime.mjs";

export { NON_ASL_WORKERS };

export async function pruneProfile(root, profile) {
  if (profile === "full") return { removed: [] };
  if (profile !== "asl-demo" && profile !== "rehearsal") throw new Error(`Unknown profile ${profile}`);
  const removed = [];
  const modelFiles = await Promise.all(NON_ASL_MODEL_DIRS.map(async dir =>
    (await readdir(join(root, "models", dir)).catch(() => [])).filter(name => !KEPT_NOTICES.has(name)).map(name => join("models", dir, name))));
  const rehearsalOnlyRemovals = profile === "rehearsal" ? [
    ...Object.keys(ASL_V31_ASSET_PINS).map(file => join(ASL_V31_ASSET_PATH.slice(1), file)),
    join("workers", ASL_V31_TRACKER_FILE), join("vision", "models", VISION_MODELS.hand.file),
  ] : [];
  for (const target of [...modelFiles.flat(), ...NON_ASL_WORKERS.map(file => join("workers", file)), ...rehearsalOnlyRemovals]) {
    if (await stat(join(root, target)).catch(() => null)) { await rm(join(root, target), { recursive: true, force: true }); removed.push(target); }
  }
  return { removed };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const profile = process.argv[2];
  const result = await pruneProfile("out", profile);
  console.log(`Profile ${profile}: removed ${result.removed.length} unsupported asset paths (${result.removed.join(", ") || "none"}).`);
}
