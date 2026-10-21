// Remove assets that a build profile does not support from out/. The ASL demo
// profile ships the ASL workspace only; other language models and their
// clip-mode workers are removed so the export cannot pretend to offer them.
// Their attribution and licence notices stay, so the linked notices still resolve.
import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { KEPT_NOTICES, NON_ASL_MODEL_DIRS } from "./verify-runtime.mjs";

export const NON_ASL_WORKERS = ["rsl.worker.js", "bdsl.worker.js"];

export async function pruneProfile(root, profile) {
  if (profile === "full") return { removed: [] };
  if (profile !== "asl-demo" && profile !== "rehearsal") throw new Error(`Unknown profile ${profile}`);
  const removed = [];
  const modelFiles = await Promise.all(NON_ASL_MODEL_DIRS.map(async dir =>
    (await readdir(join(root, "models", dir)).catch(() => [])).filter(name => !KEPT_NOTICES.has(name)).map(name => join("models", dir, name))));
  for (const target of [...modelFiles.flat(), ...NON_ASL_WORKERS.map(file => join("workers", file))]) {
    if (await stat(join(root, target)).catch(() => null)) { await rm(join(root, target), { recursive: true, force: true }); removed.push(target); }
  }
  return { removed };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const profile = process.argv[2];
  const result = await pruneProfile("out", profile);
  console.log(`Profile ${profile}: removed ${result.removed.length} unsupported asset paths (${result.removed.join(", ") || "none"}).`);
}
