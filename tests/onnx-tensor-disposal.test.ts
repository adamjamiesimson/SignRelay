// Regression coverage for a leak found while auditing the shared-model
// recognizers: bsl1064-runtime.ts and isl263-runtime.ts built an ONNX input
// tensor and read the output tensors without ever disposing either, unlike
// lse300-runtime.ts's existing try/finally pattern. onnxruntime-web's WebGPU
// execution provider (enabled first in lib/landmark-model-loader.ts) backs
// tensors with GPU buffers, so on a long signing session this leaked memory
// without bound.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeSign } from "./fixtures/asl-motion";

let createdTensors: FakeTensor[] = [];

class FakeTensor {
  data: Float32Array;
  dims: number[];
  disposed = false;
  constructor(_type: string, data: Float32Array, dims: number[]) {
    this.data = data;
    this.dims = dims;
    createdTensors.push(this);
  }
  dispose() {
    this.disposed = true;
  }
}

vi.mock("onnxruntime-web", () => ({ Tensor: FakeTensor }));

function confidentLogits(labelCount: number): Float32Array {
  const logits = new Float32Array(labelCount);
  logits[0] = 20; // softmax collapses to ~1.0 confidence, ~1.0 margin
  return logits;
}

// Every tensor created for a single recognize call - the input built from
// the live frames, plus whatever the (mocked) session.run returned - must
// come back disposed. Exactly one of each is created per call here.
function expectAllTensorsDisposed(expectedCount: number) {
  expect(createdTensors).toHaveLength(expectedCount);
  expect(createdTensors.every((tensor) => tensor.disposed)).toBe(true);
}

beforeEach(() => {
  vi.resetModules();
  createdTensors = [];
});

describe("recognizeBsl1064", () => {
  it("disposes both the input tensor and the model's output tensor", async () => {
    const labels = Array.from({ length: 1064 }, (_, index) => `sign-${index}`);
    const session = { run: vi.fn(async () => {
      const output = new FakeTensor("float32", confidentLogits(labels.length), [1, labels.length]);
      return { logits: output };
    }) };
    vi.doMock("../lib/landmark-model-loader", () => ({
      createLandmarkModelLoader: () => async () => ({ session, labels }),
    }));
    const { recognizeBsl1064 } = await import("../lib/bsl1064-runtime");
    const prediction = await recognizeBsl1064(makeSign("HELLO"));
    expect(prediction?.label).toBe("sign-0");
    expectAllTensorsDisposed(2);
  });

  it("still disposes both tensors when the prediction is rejected", async () => {
    const labels = Array.from({ length: 1064 }, (_, index) => `sign-${index}`);
    const session = { run: vi.fn(async () => {
      // Uniform logits: low confidence and no margin, rejected by the gate.
      const output = new FakeTensor("float32", new Float32Array(labels.length), [1, labels.length]);
      return { logits: output };
    }) };
    vi.doMock("../lib/landmark-model-loader", () => ({
      createLandmarkModelLoader: () => async () => ({ session, labels }),
    }));
    const { recognizeBsl1064 } = await import("../lib/bsl1064-runtime");
    const prediction = await recognizeBsl1064(makeSign("HELLO"));
    expect(prediction).toBeNull();
    expectAllTensorsDisposed(2);
  });
});

describe("recognizeIsl263", () => {
  it("disposes both the input tensor and the model's output tensor", async () => {
    const labels = Array.from({ length: 263 }, (_, index) => `sign-${index}`);
    const session = { run: vi.fn(async () => {
      const output = new FakeTensor("float32", confidentLogits(labels.length), [1, labels.length]);
      return { logits: output };
    }) };
    vi.doMock("../lib/landmark-model-loader", () => ({
      createLandmarkModelLoader: () => async () => ({ session, labels }),
    }));
    const { recognizeIsl263 } = await import("../lib/isl263-runtime");
    const prediction = await recognizeIsl263(makeSign("HELLO"));
    expect(prediction?.label).toBe("sign-0");
    expectAllTensorsDisposed(2);
  });
});
