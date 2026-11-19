import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { TASKS_VERSION, VISION_MODELS } from "../lib/vision-runtime.mjs";
import { verifyVisionRuntime } from "../scripts/verify-vision-runtime.mjs";
import { HAND_ASSET } from "./assets.mjs";
import { parseModel } from "./core.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const output = join(here, "dist-preview");
const packageDir = join(root, "node_modules", "@mediapipe", "tasks-vision");
const modelDigest = "48399c6e811c9340b59d86fe49ae1ddbbdf196a33dc38ef5f24b25ae73159603";
const wasm = {
  "vision_wasm_internal.js": "e7fd9858e8e8f221d9b96eddc11f8e077f263e0b7bbd79d3cbe882b134274f8c",
  "vision_wasm_internal.wasm": "6a5c64584c2ab61c763b6e204afbdbc7ce1caf7f5216187322bca8df94f646bc",
  "vision_wasm_nosimd_internal.js": "438d1fe8ff7f4d946025bc211c291543c037d8a3785ed4eee60f1f521b236296",
  "vision_wasm_nosimd_internal.wasm": "8a3092d34c79d3f57e6ba8592105e8a90f6b07c27891ffecd14cca428bfd3e31",
};
const pinned = (bytes, digest, name) => {
  if (createHash("sha256").update(bytes).digest("hex") !== digest) throw new Error(`${name} failed SHA-256 verification`);
  return bytes;
};
const readJson = async path => JSON.parse(await readFile(path, "utf8"));

async function taskAsset(descriptor, localPath) {
  let bytes;
  try { bytes = await readFile(localPath); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    const response = await fetch(descriptor.url, { signal: AbortSignal.timeout(60000), redirect: "error" });
    if (!response.ok) throw new Error(`Could not download ${descriptor.file} (${response.status})`);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  if (bytes.length !== descriptor.bytes) throw new Error(`${descriptor.file} failed length verification`);
  return pinned(bytes, descriptor.sha256, descriptor.file);
}

const commit = process.env.VERCEL_GIT_COMMIT_SHA || execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error("Expected a full source commit SHA");
verifyVisionRuntime(...await Promise.all([join(root, "package.json"), join(root, "package-lock.json"),
  join(packageDir, "package.json")].map(readJson)));

const model = pinned(await readFile(join(here, "models", "landmark.json")), modelDigest, "V2 landmark model");
parseModel(JSON.parse(model));
const page = (await readFile(join(here, "index.html"), "utf8"))
  .replace("<body>", "<body data-preview>")
  .replace('<code id="commit">local checkout</code>', `<code id="commit">${commit}</code>`);
const entries = new Map([
  ["index.html", page], ["style.css", await readFile(join(here, "style.css"))], ["model.json", model],
  ["profile.json", JSON.stringify({ handDelegate: "GPU", onDemandPose: true, framewiseHands: false,
    poseMode: "split", auto: true, capture: "track", warmHand: true, allowPolicySelection: true })],
]);
const [hand, pose] = await Promise.all([
  taskAsset(HAND_ASSET, join(root, "evaluation", "raw", HAND_ASSET.file)),
  taskAsset(VISION_MODELS.pose, join(root, "public", "vision", "models", VISION_MODELS.pose.file)),
]);
entries.set(`vision/models/${HAND_ASSET.file}`, hand);
entries.set(`vision/models/${VISION_MODELS.pose.file}`, pose);
for (const [file, sha] of Object.entries(wasm)) {
  entries.set(`vision/wasm/${file}`, pinned(await readFile(join(packageDir, "wasm", file)), sha, file));
}
for (const [source, file, format] of [["worker.mjs", "tracker.js", "iife"], ["pose-worker.mjs", "pose.js", "iife"],
  ["app.mjs", "app.mjs", "esm"]]) {
  const compiled = await build({ entryPoints: [join(here, source)], platform: "browser", bundle: true,
    format, write: false, minify: true, legalComments: "inline" });
  entries.set(file, compiled.outputFiles[0].contents);
}

await mkdir(output, { recursive: true });
const prior = await readdir(output, { recursive: true, withFileTypes: true });
for (const entry of prior) {
  const path = join(entry.parentPath, entry.name).slice(output.length + 1).replaceAll("\\", "/");
  if (entry.isSymbolicLink() || (entry.isFile() && !entries.has(path))
    || (entry.isDirectory() && ![...entries.keys()].some(file => file.startsWith(path + "/")))) {
    throw new Error(`Unexpected entry in preview output: ${path}`);
  }
}
for (const [path, bytes] of entries) {
  const file = join(output, path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, bytes);
}
console.log(`Built standalone V2 at ${commit}, MediaPipe ${TASKS_VERSION}, ${entries.size} allowlisted files`);
