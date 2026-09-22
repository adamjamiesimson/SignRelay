// Numerical verification on one real publisher clip, not a live accuracy test.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import * as ort from "onnxruntime-web";

const directory = resolve(process.argv[2] ?? "work/bdsl401-export");
const report = JSON.parse(await readFile(resolve(directory, "verification.json"), "utf8"));
const model = await readFile(resolve(directory, "model.onnx"));
assert.equal(createHash("sha256").update(model).digest("hex"), report.modelSha256);
async function floats(name) {
  const bytes = await readFile(resolve(directory, name));
  return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}
const input = await floats("wasm-input.f32");
const expected = await floats("wasm-expected.f32");
assert.equal(input.length, 16 * 3 * 224 * 224);
assert.equal(expected.length, 401);
ort.env.wasm.numThreads = 1;
const started = performance.now();
const session = await ort.InferenceSession.create(model, { executionProviders: ["wasm"] });
const loadMs = Math.round(performance.now() - started);
let result;
try {
  const inferenceStarted = performance.now();
  const output = await session.run({ pixel_values: new ort.Tensor("float32", input, [1, 16, 3, 224, 224]) });
  const inferenceMs = Math.round(performance.now() - inferenceStarted);
  assert.deepEqual(output.logits.dims, [1, 401]);
  const actual = output.logits.data;
  assert(actual instanceof Float32Array);
  let maxAbsLogitError = 0;
  for (let i = 0; i < expected.length; i++) {
    assert(Number.isFinite(actual[i]));
    const error = Math.abs(actual[i] - expected[i]);
    assert(error <= 2e-4 + 2e-4 * Math.abs(expected[i]), `Mismatch at class ${i}`);
    maxAbsLogitError = Math.max(maxAbsLogitError, error);
  }
  result = { engine: "onnxruntime-web single-thread WASM in Node", modelSha256: report.modelSha256,
    clip: report.clips[0].file, maxAbsLogitError, loadMs, inferenceMs,
    browserTested: false, liveCameraTested: false, installed: false };
} finally {
  await session.release();
}
await writeFile(resolve(directory, "wasm-verification.json"), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result, null, 2));
