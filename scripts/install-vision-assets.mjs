import { copyFile, mkdir, readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { installVerifiedAsset } from "./verified-download.mjs";

const directory = new URL("../public/vision/", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("vision-assets.json", import.meta.url), "utf8"));
await mkdir(directory, { recursive: true });
// The JS wrapper and WASM must come from the SAME locked npm version.
const distribution = dirname(createRequire(import.meta.url).resolve("@mediapipe/tasks-vision"));
const wasmDirectory = new URL("wasm/", directory);
await mkdir(wasmDirectory, { recursive: true });
for (const file of await readdir(join(distribution, "wasm"))) {
  if (/^vision_wasm_\w+\.(js|wasm)$/.test(file)) {
    await copyFile(join(distribution, "wasm", file), new URL(file, wasmDirectory));
  }
}
for (const asset of manifest.assets) {
  console.log(`Vision ${asset.name}: ${await installVerifiedAsset(new URL(asset.name, directory), asset)}`);
}
console.log("Local hand, face and pose tracking assets verified.");
