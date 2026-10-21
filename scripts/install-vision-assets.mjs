// Self-host the MediaPipe Tasks runtime: copy WASM from the locked npm package
// and install the three pinned models (size + SHA-256 verified) into
// public/vision/. Never trusts an unverified download. `--wasm-only` skips network.
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import { VISION_MODELS, VISION_WASM_FILES } from "../lib/vision-runtime.mjs";

const require = createRequire(import.meta.url);
const root = new URL("../public/vision/", import.meta.url);
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

export async function copyWasm() {
  const source = join(dirname(require.resolve("@mediapipe/tasks-vision")), "wasm");
  const target = new URL("wasm/", root);
  await mkdir(target, { recursive: true });
  for (const file of VISION_WASM_FILES) await copyFile(join(source, file), new URL(file, target));
  return VISION_WASM_FILES.length;
}

export async function installModels(fetchImpl = fetch, target = new URL("models/", root)) {
  await mkdir(target, { recursive: true });
  const installed = [];
  for (const [name, model] of Object.entries(VISION_MODELS)) {
    const destination = new URL(model.file, target);
    const existing = await readFile(destination).catch(() => null);
    if (existing && existing.length === model.bytes && sha256(existing) === model.sha256) { installed.push(`${name} (cached)`); continue; }
    const response = await fetchImpl(model.url, { signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error(`${model.file}: HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length !== model.bytes || sha256(bytes) !== model.sha256) throw new Error(`${model.file}: size or SHA-256 differs from the pinned model; refusing to install`);
    const partial = new URL(`${model.file}.${process.pid}.partial`, target);
    await writeFile(partial, bytes);
    await rename(partial, destination).catch(async error => { await rm(partial, { force: true }); throw error; });
    installed.push(name);
  }
  return installed;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const copied = await copyWasm();
  if (process.argv.includes("--wasm-only")) console.log(`Self-hosted ${copied} MediaPipe WASM files.`);
  else console.log(`Self-hosted ${copied} MediaPipe WASM files and verified models: ${(await installModels()).join(", ")}.`);
}
