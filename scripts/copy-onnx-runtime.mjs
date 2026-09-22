import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

// esbuild embeds ORT's JavaScript factory, but its WASM binary is still loaded
// relative to recognition.worker.js. Ship the exact installed package version.
const require = createRequire(import.meta.url);
const distribution = dirname(require.resolve("onnxruntime-web"));
const destination = new URL("../public/workers/", import.meta.url);
await mkdir(destination, { recursive: true });
for (const file of ["ort-wasm-simd-threaded.jsep.wasm", "ort-wasm-simd-threaded.jsep.mjs"]) {
  await copyFile(join(distribution, file), new URL(file, destination));
}
