// Promote only the exact compact export that passed native/WASM and input parity.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const source = resolve(process.argv[2] || "work/bdsl401-weight-only");
const inputs = resolve(process.argv[3] || "work/bdsl-browser-preprocessing/verification.json");
const json = async path => JSON.parse(await readFile(path, "utf8"));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const verification = await json(resolve(source, "verification.json"));
const wasm = await json(resolve(source, "wasm-int8.json"));
const preprocessing = await json(inputs);
const bytes = await readFile(resolve(source, "model.int8.onnx"));
const modelSha256 = hash(bytes);
assert.equal(modelSha256, "600c7a8064e5b41f24d145165990493c996ab7cf4b3a554aa7b354f18bad40a6", "Only the verified weight-only model may be installed");
assert.equal(verification.mode, "weight-only");
assert.equal(verification.variants.int8.modelSha256, modelSha256);
assert.equal(wasm.modelSha256, modelSha256);
assert.equal(wasm.numericalParityPassed, true);
assert.equal(wasm.total, 6);
assert.equal(wasm.top5MatchesNativeCount, 6);
assert.equal(preprocessing.passed, true);
assert.equal(preprocessing.clips.length, 6);
assert(preprocessing.clips.every(clip => clip.passed));
assert.equal(preprocessing.typescriptSha256, hash(await readFile("lib/bdsl-video.ts")));
const codes = await json(resolve(source, "class-codes.json"));
assert.deepEqual(codes, Array.from({ length: 401 }, (_, index) => `W${String(index + 1).padStart(3, "0")}`));
const labels = await json(resolve(source, "labels.json"));
const vocabulary = await json("training/bdsl401_vocabulary.json");
assert.equal(labels.length, 401);
assert.equal(new Set(labels).size, 398);
assert.equal(verification.vocabularySha256, hash(await readFile("training/bdsl401_vocabulary.json")));
// Vocabulary was checked by the exporter; retain its provenance in the manifest.
assert(vocabulary.source);
const directory = resolve("public/models/bdsl401-videomae");
await mkdir(directory, { recursive: true });
await copyFile(resolve(source, "model.int8.onnx"), resolve(directory, "model.onnx"));
await copyFile(resolve(source, "labels.json"), resolve(directory, "labels.json"));
await copyFile(resolve(source, "class-codes.json"), resolve(directory, "class-codes.json"));
await writeFile(resolve(directory, "manifest.json"), JSON.stringify({
  name: "BdSLW401 VideoMAE, weight-only int8 storage", bytes: bytes.length, sha256: modelSha256,
  labelsSha256: hash(await readFile(resolve(directory, "labels.json"))), classes: 401, distinctEnglishGlosses: 398,
  input: "pixel_values", shape: [1, 16, 3, 224, 224], output: "logits",
  source: verification.source, sourceCheckpointSha256: verification.sourceHashes["model.safetensors"],
  license: "CC-BY-NC-4.0 (model weights)", vocabularySource: vocabulary.source,
  validation: "Native/WASM numerical and TypeScript/PyTorch input parity passed on six pinned clips; live signer accuracy unmeasured.",
}, null, 2) + "\n");
console.log("Installed verified Bangla candidate assets. Browser verification and adapter activation are separate steps.");
