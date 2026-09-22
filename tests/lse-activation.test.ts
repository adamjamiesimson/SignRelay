import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ readFile: vi.fn(), writeFile: vi.fn(), create: vi.fn(), release: vi.fn(), run: vi.fn() }));
vi.mock("node:fs/promises", () => ({ readFile: mocks.readFile, writeFile: mocks.writeFile }));
vi.mock("onnxruntime-web", () => ({
  env: { wasm: { numThreads: 0 } },
  InferenceSession: { create: mocks.create },
  Tensor: class {},
}));

// Explicit test fixtures; these are never written into the model directory.
const bytes = Buffer.from("fixture only");
const source = readFileSync("lib/model-adapters.ts", "utf8");
let metadata: Record<string, unknown>;
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  metadata = {
    classes: 300, sequenceLength: 64, inputFeatures: 183, exportVerified: true,
    source: { validationAccuracy: 0.6, testAccuracy: 0.5 },
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
  mocks.readFile.mockImplementation(async (url: URL) => {
    if (url.pathname.endsWith("model.json")) return JSON.stringify(metadata);
    if (url.pathname.endsWith("labels.json")) return JSON.stringify(Array.from({ length: 300 }, (_, i) => `sign-${i}`));
    if (url.pathname.endsWith("model.onnx")) return bytes;
    return source;
  });
  mocks.run.mockResolvedValue({ logits: { dims: [1, 300], data: new Float32Array(300) } });
  mocks.create.mockResolvedValue({ run: mocks.run, release: mocks.release });
});

it("activates only the LSE adapter after WASM execution succeeds", async () => {
  await import("../scripts/activate-lse-model.mjs");
  expect(mocks.release).toHaveBeenCalledOnce();
  expect(mocks.writeFile).toHaveBeenCalledOnce();
  const updated = mocks.writeFile.mock.calls[0][1] as string;
  const block = /  lse: \{[\s\S]*?\n  \},/g;
  expect(updated.replace(block, "")).toBe(source.replace(block, ""));
  expect(updated.match(block)?.[0]).toContain('status: "experimental"');
  expect(updated.match(block)?.[0]).toContain("automaticVocabularyCount: 300");
  expect(updated.match(block)?.[0]).not.toContain("pending");
});

it("does not enable a model with a mismatched integrity hash", async () => {
  metadata.sha256 = "wrong";
  await expect(import("../scripts/activate-lse-model.mjs")).rejects.toThrow("training/export contract");
  expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.writeFile).not.toHaveBeenCalled();
});

it("releases the session and keeps LSE pending when browser output is invalid", async () => {
  mocks.run.mockResolvedValue({ logits: { dims: [1, 300], data: Float32Array.from([NaN]) } });
  await expect(import("../scripts/activate-lse-model.mjs")).rejects.toThrow("WASM execution");
  expect(mocks.release).toHaveBeenCalledOnce();
  expect(mocks.writeFile).not.toHaveBeenCalled();
});
