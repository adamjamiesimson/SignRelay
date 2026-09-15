// Run each variant in a fresh Node process so peak RSS can be compared.
// This exercises the WASM engine, not a browser or live camera.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { cpus } from "node:os";
import * as ort from "onnxruntime-web";

const [variant, modelArgument, directoryArgument = "work/bdsl401-int8"] = process.argv.slice(2);
assert(["float32", "int8"].includes(variant), "Choose float32 or int8, followed by its ONNX path");
assert(modelArgument, "An explicit ONNX path is required");
const directory = resolve(directoryArgument);
const reportPath = resolve(directory, `wasm-${variant}.json`);
await unlink(reportPath).catch((error) => { if (error.code !== "ENOENT") throw error; });
const verification = JSON.parse(await readFile(resolve(directory, "verification.json"), "utf8"));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const model = await readFile(resolve(modelArgument));
assert.equal(hash(model), verification.variants[variant].modelSha256);

async function floats(fixture, length) {
  const path = resolve(directory, fixture.path);
  assert(path.startsWith(`${directory}/fixtures/`), "Fixture must be inside the experiment directory");
  const bytes = await readFile(path);
  assert.equal(hash(bytes), fixture.sha256);
  assert.equal(bytes.byteLength, length * 4);
  const values = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  assert(values.every(Number.isFinite));
  return values;
}

ort.env.wasm.numThreads = 1;
const started = performance.now();
const session = await ort.InferenceSession.create(model, { executionProviders: ["wasm"] });
const loadMs = Math.round(performance.now() - started);
const results = [];
try {
  for (const [index, clip] of verification.clips.entries()) {
    const input = await floats(clip.fixtures.input, 16 * 3 * 224 * 224);
    const expected = await floats(clip.fixtures[variant], 401);
    const tensor = new ort.Tensor("float32", input, [1, 16, 3, 224, 224]);
    if (index === 0) {
      const warmup = await session.run({ pixel_values: tensor });
      for (const output of Object.values(warmup)) output.dispose();
    }
    const inferenceStarted = performance.now();
    const outputs = await session.run({ pixel_values: tensor });
    const inferenceMs = Math.round(performance.now() - inferenceStarted);
    try {
      assert.deepEqual(outputs.logits.dims, [1, 401]);
      const actual = outputs.logits.data;
      assert(actual instanceof Float32Array);
      let maxAbsLogitError = 0;
      let toleranceFailureCount = 0;
      for (let i = 0; i < expected.length; i++) {
        assert(Number.isFinite(actual[i]));
        const error = Math.abs(actual[i] - expected[i]);
        if (error > 2e-4 + 2e-4 * Math.abs(expected[i])) toleranceFailureCount++;
        maxAbsLogitError = Math.max(maxAbsLogitError, error);
      }
      const top5 = Array.from(actual, (value, i) => ({ value, i }))
        .sort((a, b) => b.value - a.value || a.i - b.i).slice(0, 5)
        .map(({ i }) => `W${String(i + 1).padStart(3, "0")}`);
      const nativeTop5 = clip.variants[variant].top5;
      const result = { file: clip.file, sha256: clip.sha256, expectedCode: clip.expectedCode,
        top5, top1Correct: top5[0] === clip.expectedCode, top5Correct: top5.includes(clip.expectedCode),
        inferenceMs, maxAbsLogitError, toleranceFailureCount,
        numericalParityPassed: toleranceFailureCount === 0,
        top1MatchesNative: top5[0] === nativeTop5[0],
        top5MatchesNative: top5.every((code, i) => code === nativeTop5[i]) };
      results.push(result);
      console.log(JSON.stringify(result));
    } finally {
      tensor.dispose();
      for (const output of Object.values(outputs)) output.dispose();
    }
  }
} finally {
  await session.release();
}
const orderedTimes = results.map((row) => row.inferenceMs).sort((a, b) => a - b);
assert.equal(orderedTimes.length, 6, "All six pinned examples must be measured");
const report = { variant, engine: "onnxruntime-web single-thread WASM in Node",
  quantizationMode: verification.mode ?? "dynamic", method: verification.method,
  nodeVersion: process.version, ortVersions: ort.env.versions,
  host: { platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model, logicalCpus: cpus().length },
  modelSha256: verification.variants[variant].modelSha256, modelBytes: model.byteLength,
  reference: `Native ONNX Runtime ${verification.versions.onnxruntime}, same ${variant} model`,
  timing: "Fresh process per variant; one untimed warm-up; one timed inference for each of six clips",
  loadMs, medianInferenceMs: (orderedTimes[2] + orderedTimes[3]) / 2,
  peakProcessRssKiB: process.resourceUsage().maxRSS,
  memoryScope: "Peak resident memory of the whole Node process, including model buffers, fixtures and WASM; not browser memory",
  clips: results, top1Count: results.filter((row) => row.top1Correct).length,
  top5Count: results.filter((row) => row.top5Correct).length, total: results.length,
  parityTolerance: { absolute: 2e-4, relative: 2e-4 },
  numericalParityPassed: results.every((row) => row.numericalParityPassed),
  top1MatchesNativeCount: results.filter((row) => row.top1MatchesNative).length,
  top5MatchesNativeCount: results.filter((row) => row.top5MatchesNative).length,
  browserTested: false, liveCameraTested: false, installed: false };
await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ variant, loadMs, medianInferenceMs: report.medianInferenceMs, peakProcessRssKiB: report.peakProcessRssKiB }));
// Retain all failed measurements, but keep a failing verification exit status.
if (!report.numericalParityPassed || report.top5MatchesNativeCount !== results.length) process.exitCode = 1;
