import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { TASKS_VERSION } from "../lib/vision-runtime.mjs";

export function verifyVisionRuntime(manifest, lock, installed) {
  if (manifest.dependencies?.["@mediapipe/tasks-vision"] !== TASKS_VERSION
    || lock.packages?.[""]?.dependencies?.["@mediapipe/tasks-vision"] !== TASKS_VERSION
    || lock.packages?.["node_modules/@mediapipe/tasks-vision"]?.version !== TASKS_VERSION
    || installed?.version !== TASKS_VERSION) {
    throw new Error(`MediaPipe JS, lockfile and WASM must all pin ${TASKS_VERSION}; run npm ci after updating the exact dependency`);
  }
  return TASKS_VERSION;
}

export async function checkVisionRuntime() {
  const [manifest, lock, installed] = await Promise.all([
    "package.json", "package-lock.json", "node_modules/@mediapipe/tasks-vision/package.json",
  ].map(async file => JSON.parse(await readFile(file, "utf8"))));
  return verifyVisionRuntime(manifest, lock, installed);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(`Verified MediaPipe JS/WASM ${await checkVisionRuntime()}`);
}
