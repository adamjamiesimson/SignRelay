import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import * as ort from "onnxruntime-web";
import { describe, expect, it } from "vitest";

describe("installed ONNX assets (execution checks, not sign accuracy)", () => {
  it("copies the matching browser WASM and fallback module during the build", () => {
    execFileSync(process.execPath, ["scripts/copy-onnx-runtime.mjs"]);
    const distribution = dirname(createRequire(import.meta.url).resolve("onnxruntime-web"));
    const hash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
    for (const name of ["ort-wasm-simd-threaded.jsep.wasm", "ort-wasm-simd-threaded.jsep.mjs"]) {
      expect(hash(`public/workers/${name}`)).toBe(hash(join(distribution, name)));
    }
    const header = readFileSync("public/workers/ort-wasm-simd-threaded.jsep.wasm").subarray(0, 4);
    expect([...header]).toEqual([0, 97, 115, 109]);
  });

  it.each([
    { directory: "bsl1064-pose2sign", input: "pose", dims: [1, 3, 16, 60], classes: 1064 },
    { directory: "isl263-include", input: "landmarks", dims: [1, 200, 134], classes: 263 },
  ])("executes $directory in WASM with the expected class mapping", async ({ directory, input, dims, classes }) => {
    ort.env.wasm.numThreads = 1;
    const labels = JSON.parse(readFileSync(`public/models/${directory}/labels.json`, "utf8")) as string[];
    expect(labels).toHaveLength(classes);
    expect(labels.every(label => typeof label === "string" && label.trim().length > 0)).toBe(true);
    const session = await ort.InferenceSession.create(readFileSync(`public/models/${directory}/model.onnx`), { executionProviders: ["wasm"] });
    try {
      const values = new Float32Array(dims.reduce((a, b) => a * b));
      const outputs = await session.run({ [input]: new ort.Tensor("float32", values, dims) });
      expect(outputs.logits.dims).toEqual([1, classes]);
      expect(Array.from(outputs.logits.data as Float32Array).every(Number.isFinite)).toBe(true);
    } finally {
      await session.release();
    }
  });
});
