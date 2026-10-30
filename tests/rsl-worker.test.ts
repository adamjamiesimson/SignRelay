// The RSL worker against a mocked onnxruntime-web: resource handling only.
// Real Slovo inference is covered by tests/rsl-browser-smoke.mjs.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RSL_FRAME_BYTES, RSL_FRAMES } from "../lib/rsl-video";

const ort = vi.hoisted(() => ({ create: vi.fn(), tensors: [] as Array<{ disposed: boolean }> }));
vi.mock("onnxruntime-web", () => ({
  env: { wasm: {} },
  InferenceSession: { create: ort.create },
  Tensor: class { disposed = false; constructor(public type: string, public data: unknown, public dims: number[]) { ort.tensors.push(this); }
    dispose() { this.disposed = true; } },
}));

type Message = { type: string };
let worker: { onmessage: (event: { data: unknown }) => Promise<void>; postMessage: ReturnType<typeof vi.fn> };
const sent = () => worker.postMessage.mock.calls.map(([message]) => message as Message);

function session(inputNames = ["input"], outputNames = ["output"]) {
  const probabilities = new Float32Array(1001); probabilities[1000] = 1;
  const output = { data: probabilities, dims: [1, 1001], disposed: false, dispose() { this.disposed = true; } };
  return { inputNames, outputNames, output, release: vi.fn(async () => {}), run: vi.fn(async () => ({ output })) };
}
// Alternating frames: enough change for the idle-clip guard.
const moving = () => Array.from({ length: RSL_FRAMES }, (_, index) => new Uint8ClampedArray(RSL_FRAME_BYTES).fill(index % 8 < 4 ? 0 : 255));

beforeEach(async () => {
  vi.resetModules(); ort.create.mockReset(); ort.tensors = [];
  worker = { onmessage: async () => {}, postMessage: vi.fn() };
  vi.stubGlobal("self", worker);
  await import("../workers/rsl.worker");
});

describe("RSL worker resources", () => {
  it("releases a model that fails its contract and does not keep it for later requests", async () => {
    const wrong = session(["pixel_values"]), right = session();
    ort.create.mockResolvedValueOnce(wrong).mockResolvedValueOnce(right);
    await worker.onmessage({ data: { type: "load" } });
    expect(wrong.release).toHaveBeenCalledOnce();
    expect(sent().at(-1)?.type).toBe("error");
    await worker.onmessage({ data: { type: "recognize", frames: moving() } });
    expect(wrong.run).not.toHaveBeenCalled();
    expect(sent().at(-1)?.type).toBe("error");
    await worker.onmessage({ data: { type: "load" } });
    expect(ort.create).toHaveBeenCalledTimes(2);
    expect(sent().at(-1)?.type).toBe("ready");
  });

  it("disposes the input and output tensors after every inference, including a failed decode", async () => {
    const loaded = session();
    ort.create.mockResolvedValue(loaded);
    await worker.onmessage({ data: { type: "load" } });
    await worker.onmessage({ data: { type: "recognize", frames: moving() } });
    expect(sent().at(-1)).toEqual({ type: "result", prediction: null });
    expect(ort.tensors).toHaveLength(1);
    expect(ort.tensors[0].disposed).toBe(true);
    expect(loaded.output.disposed).toBe(true);

    loaded.output.disposed = false;
    loaded.output.data = new Float32Array(10);
    await worker.onmessage({ data: { type: "recognize", frames: moving() } });
    expect(sent().at(-1)?.type).toBe("error");
    expect(ort.tensors[1].disposed).toBe(true);
    expect(loaded.output.disposed).toBe(true);
  });

  it("rejects an unknown request instead of treating it as recognition", async () => {
    const loaded = session();
    ort.create.mockResolvedValue(loaded);
    await worker.onmessage({ data: { type: "load" } });
    await worker.onmessage({ data: { type: "unload", frames: moving() } });
    expect(loaded.run).not.toHaveBeenCalled();
    expect(sent().at(-1)?.type).toBe("error");
  });
});
