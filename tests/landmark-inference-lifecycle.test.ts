import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeSign } from "./fixtures/asl-motion";

const state = vi.hoisted(() => ({ run: vi.fn(), tensors: [] as { dispose: ReturnType<typeof vi.fn> }[] }));
vi.mock("onnxruntime-web", () => ({
  Tensor: class {
    dispose = vi.fn();
    constructor() { state.tensors.push(this); }
  },
}));
vi.mock("../lib/landmark-model-loader", () => ({
  createLandmarkModelLoader: (_directory: string, count: number) => {
    const session = { run: state.run };
    const labels = Array.from({ length: count }, (_, index) => `SIGN-${index}`);
    return async () => ({ session, labels });
  },
}));

const variants = [
  { language: "BSL", count: 1064, load: async () => (await import("../lib/bsl1064-runtime")).recognizeBsl1064 },
  { language: "ISL", count: 263, load: async () => (await import("../lib/isl263-runtime")).recognizeIsl263 },
  { language: "LSE", count: 300, load: async () => (await import("../lib/lse300-runtime")).recognizeLse300 },
];
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const output = (count: number) => {
  const data = new Float32Array(count); data[0] = 20;
  return { logits: { data, dispose: vi.fn() } };
};

beforeEach(() => { vi.resetModules(); state.run.mockReset(); state.tensors.length = 0; });
afterEach(() => vi.restoreAllMocks());

describe.each(variants)("$language inference across camera/language resets", ({ count, load }) => {
  it("waits for a cancelled native run to finish before reusing its cached session", async () => {
    const recognize = await load(), controller = new AbortController();
    let finish!: (value: ReturnType<typeof output>) => void;
    state.run.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
      .mockResolvedValue(output(count));
    const first = recognize(makeSign("HELLO"), { signal: controller.signal });
    const rejected = expect(first).rejects.toMatchObject({ name: "AbortError" });
    await flush(); expect(state.run).toHaveBeenCalledOnce();
    controller.abort();
    const second = recognize(makeSign("HELLO"));
    await flush();
    expect(state.run).toHaveBeenCalledOnce();
    expect(state.tensors).toHaveLength(1);
    expect(state.tensors[0].dispose).not.toHaveBeenCalled();
    const oldOutput = output(count); finish(oldOutput);
    await rejected;
    expect(await second).toMatchObject({ label: "SIGN-0" });
    expect(oldOutput.logits.dispose).toHaveBeenCalledOnce();
    expect(state.tensors.every(tensor => tensor.dispose.mock.calls.length === 1)).toBe(true);
  });

  it("removes a cancelled waiter without allocating tensors or blocking the next session", async () => {
    const recognize = await load(), controller = new AbortController();
    let finish!: (value: ReturnType<typeof output>) => void;
    state.run.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
      .mockResolvedValue(output(count));
    const first = recognize(makeSign("HELLO")); await flush();
    const waiting = recognize(makeSign("HELLO"), { signal: controller.signal });
    const rejected = expect(waiting).rejects.toMatchObject({ name: "AbortError" });
    await flush(); controller.abort(); await rejected;
    expect(state.run).toHaveBeenCalledOnce(); expect(state.tensors).toHaveLength(1);
    const next = recognize(makeSign("HELLO"));
    finish(output(count));
    await first; expect(await next).toMatchObject({ label: "SIGN-0" });
    expect(state.run).toHaveBeenCalledTimes(2);
  });

  it("releases the session after a failed run so a queued fresh request can recover", async () => {
    const recognize = await load();
    let fail!: (error: Error) => void;
    state.run.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }))
      .mockResolvedValue(output(count));
    const first = recognize(makeSign("HELLO"));
    const rejected = expect(first).rejects.toThrow("native failure"); await flush();
    const next = recognize(makeSign("HELLO")); await flush();
    expect(state.run).toHaveBeenCalledOnce(); fail(new Error("native failure"));
    await rejected; expect(await next).toMatchObject({ label: "SIGN-0" });
    expect(state.tensors.every(tensor => tensor.dispose.mock.calls.length === 1)).toBe(true);
  });
});
