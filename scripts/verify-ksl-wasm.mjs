// Actual checkpoint, synthetic fixtures: numerical verification, not accuracy.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import * as ort from "onnxruntime-web";

const directory = resolve(process.argv[2] ?? "work/ksl2946");
const model = await readFile(resolve(directory, "model.onnx"));
const report = JSON.parse(await readFile(resolve(directory, "verification.json"), "utf8"));
assert.equal(createHash("sha256").update(model).digest("hex"), report.modelSha256);
ort.env.wasm.numThreads = 1;
const session = await ort.InferenceSession.create(model, { executionProviders: ["wasm"] });
const results = [];
async function floats(name) {
  const bytes = await readFile(resolve(directory, name));
  return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}
try {
  for (const length of [1, 17, 64]) {
    const input = await floats(`input-${length}.f32`), expected = await floats(`expected-${length}.f32`);
    assert.equal(input.length, 64 * 115 * 4);
    assert.equal(expected.length, 2946);
    const started = performance.now();
    const output = await session.run({
      keypoints: new ort.Tensor("float32", input, [1, 64, 115, 4]),
      lengths: new ort.Tensor("int64", BigInt64Array.of(BigInt(length)), [1]),
    });
    assert.deepEqual(output.logits.dims, [1, 2946]);
    const actual = output.logits.data;
    assert(actual instanceof Float32Array);
    let maxError = 0;
    for (let i = 0; i < expected.length; i++) {
      assert(Number.isFinite(actual[i]));
      const error = Math.abs(actual[i] - expected[i]);
      assert(error <= 2e-4 + 2e-4 * Math.abs(expected[i]), `WASM mismatch at class ${i}`);
      maxError = Math.max(maxError, error);
    }
    results.push({ length, maxAbsError: maxError, elapsedMs: Math.round(performance.now() - started) });
  }
} finally { await session.release(); }
const result = { engine: "onnxruntime-web single-thread WASM in Node", modelSha256: report.modelSha256,
  results, signAccuracyMeasuredHere: false };
await writeFile(resolve(directory, "wasm-verification.json"), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result, null, 2));
