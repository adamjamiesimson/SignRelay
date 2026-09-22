import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import * as ort from "onnxruntime-web";

const directory = new URL("../public/models/lse300-swl/", import.meta.url);
const metadata = JSON.parse(await readFile(new URL("model.json", directory), "utf8"));
const labels = JSON.parse(await readFile(new URL("labels.json", directory), "utf8"));
const bytes = await readFile(new URL("model.onnx", directory));
if (!Array.isArray(labels) || labels.length !== 300 || new Set(labels).size !== 300
  || labels.some(label => typeof label !== "string" || !label.trim())
  || metadata.classes !== 300 || metadata.sequenceLength !== 64 || metadata.inputFeatures !== 183
  || metadata.exportVerified !== true
  || !Number.isFinite(metadata.source?.validationAccuracy) || metadata.source.validationAccuracy < 0.5
  || !Number.isFinite(metadata.source?.testAccuracy)
  || metadata.sha256 !== createHash("sha256").update(bytes).digest("hex")) {
  throw new Error("LSE model has not passed the training/export contract");
}

// Exercise the browser backend before advertising an installed model.
ort.env.wasm.numThreads = 1;
const session = await ort.InferenceSession.create(bytes, { executionProviders: ["wasm"] });
try {
  const outputs = await session.run({ landmarks: new ort.Tensor("float32", new Float32Array(64 * 183), [1, 64, 183]) });
  if (outputs.logits?.dims.join(",") !== "1,300"
    || !Array.from(outputs.logits.data).every(value => typeof value === "number" && Number.isFinite(value))) {
    throw new Error("LSE model failed browser WASM execution");
  }
} finally {
  await session.release();
}

const adapterPath = new URL("../lib/model-adapters.ts", import.meta.url);
const source = await readFile(adapterPath, "utf8");
const pattern = /  lse: \{[\s\S]*?\n  \},/g;
const matches = source.match(pattern);
if (matches?.length !== 1) throw new Error("Expected exactly one LSE adapter");
const block = matches[0]
  .replace(/    \/\/ The installer workflow[^\n]*\n    \/\/ commit[^\n]*\n/, "")
  .replace(/status: "(?:preparing|experimental)"/, 'status: "experimental"')
  .replace(/modelFile: [^\n]+/, 'modelFile: "SWL-LSE temporal landmark model + on-device personal recognizer",')
  .replace(/automaticVocabularyCount: \d+/, "automaticVocabularyCount: 300")
  .replace(/decoder: [^\n]+/, 'decoder: "Locally trained SWL-LSE temporal landmark classifier; personal templates take priority",')
  .replace(/postProcessing: [^\n]+/, 'postProcessing: "Confidence and margin gating plus temporal consensus",')
  .replace(/version: [^\n]+/, 'version: "swl-lse300-temporal-landmark-v1",')
  .replace(/summary: [^\n]+/, 'summary: "A local 300-sign Spanish health-domain research model. Held-out dataset results are recorded with the model; live-camera accuracy remains unmeasured.",');
await writeFile(adapterPath, source.replace(pattern, () => block));
console.log("LSE model passed integrity, label and WASM checks; adapter activated.");
