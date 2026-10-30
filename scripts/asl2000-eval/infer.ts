// Isolated ASL-2000 evaluation, step 2 (parity subset): run the shipped JS
// runtime on identical float32 windows and record logits and latency.
// node infer.mjs windows.bin out-logits.bin [maxWindows]
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { runPackedTgcn, type TgcnManifest } from "../../lib/asl1000-runtime";

const [inputPath, outputPath, limit] = process.argv.slice(2);
if (!inputPath || !outputPath) throw new Error("Usage: infer windows.bin out-logits.bin [maxWindows]");
const root = "public/models/asl2000-tgcn";
const manifest = JSON.parse(readFileSync(`${root}/model.json`, "utf8")) as TgcnManifest;
const labels = JSON.parse(readFileSync(`${root}/labels.json`, "utf8")) as string[];
const bytes = gunzipSync(Buffer.concat(manifest.binaryParts.map(name => readFileSync(`${root}/${name}`))));
const binary = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const raw = readFileSync(inputPath);
const inputs = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
const size = 55 * 100;
const count = Math.min(inputs.length / size, limit ? Number(limit) : Infinity);
const logits = new Float32Array(count * manifest.classes);
const times: number[] = [];
for (let i = 0; i < count; i++) {
  const started = performance.now();
  logits.set(runPackedTgcn(manifest, binary, labels, inputs.slice(i * size, (i + 1) * size)), i * manifest.classes);
  times.push(performance.now() - started);
}
writeFileSync(outputPath, Buffer.from(logits.buffer));
times.sort((a, b) => a - b);
console.log(JSON.stringify({ windows: count, js_runtime_ms: { median: times[Math.floor(count / 2)], p90: times[Math.floor(count * 0.9)], max: times.at(-1) } }));
