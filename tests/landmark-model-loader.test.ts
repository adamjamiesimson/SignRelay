import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLandmarkModelLoader } from "../lib/landmark-model-loader";

const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("onnxruntime-web", () => ({ InferenceSession: { create } }));
const labels = ["HELLO", "THANK YOU"];
const response = (data: unknown = labels) => new Response(JSON.stringify(data));
const fetched = (data: unknown = labels) => vi.fn(async (url: string) => url.endsWith("labels.json") ? response(data) : new Response(new Uint8Array([1, 2, 3])));
beforeEach(() => { create.mockReset(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("landmark model loading", () => {
  it("shares concurrent loads and caches the successful model", async () => {
    const session = { run: vi.fn() };
    create.mockResolvedValue(session);
    const fetch = fetched();
    vi.stubGlobal("fetch", fetch);
    const load = createLandmarkModelLoader("/models/example", 2);
    const [a, b] = await Promise.all([load(), load()]);
    expect(a).toBe(b);
    expect(await load()).toBe(a);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(create).toHaveBeenCalledTimes(1);
    expect(a).toEqual({ session, labels });
  });

  it("recovers from a failed label download without creating an orphan session", async () => {
    const fetch = fetched().mockRejectedValueOnce(new Error("offline"));
    vi.stubGlobal("fetch", fetch);
    create.mockResolvedValue({});
    const load = createLandmarkModelLoader("/models/example", 2);
    await expect(load()).rejects.toThrow("offline");
    expect(create).not.toHaveBeenCalled();
    await expect(load()).resolves.toMatchObject({ labels });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("retries failed session creation on the next worker attempt", async () => {
    vi.stubGlobal("fetch", fetched());
    create.mockRejectedValueOnce(new Error("model download failed")).mockResolvedValue({});
    const load = createLandmarkModelLoader("/models/example", 2);
    await expect(load()).rejects.toThrow("model download failed");
    await expect(load()).resolves.toMatchObject({ labels });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it.each([null, {}, ["HELLO"], ["HELLO", ""], ["HELLO", 42], ["HELLO", "HELLO"]])(
    "rejects invalid label contracts before allocating a model: %j", async data => {
      vi.stubGlobal("fetch", fetched(data));
      await expect(createLandmarkModelLoader("/models/example", 2)()).rejects.toThrow("distinct, nonempty");
      expect(create).not.toHaveBeenCalled();
    },
  );

  it("keeps language caches independent", async () => {
    vi.stubGlobal("fetch", fetched());
    create.mockResolvedValue({});
    await Promise.all([
      createLandmarkModelLoader("/models/bsl", 2)(),
      createLandmarkModelLoader("/models/isl", 2)(),
    ]);
    expect(create).toHaveBeenCalledTimes(2);
    expect(vi.mocked(fetch).mock.calls.map(call => call[0])).toEqual(["/models/bsl/labels.json", "/models/isl/labels.json", "/models/bsl/model.onnx", "/models/isl/model.onnx"]);
  });

  it("aborts a partial model download and retries with complete bytes", async () => {
    let body!: ReadableStreamDefaultController<Uint8Array>;
    const fetch = fetched().mockImplementationOnce(async () => response())
      .mockImplementationOnce(async () => new Response(new ReadableStream({ start(controller) { body = controller; } })));
    vi.stubGlobal("fetch", fetch); create.mockResolvedValue({ release: vi.fn() });
    const load = createLandmarkModelLoader("/models/example", 2), controller = new AbortController();
    const task = load(controller.signal); const assertion = expect(task).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(body).toBeDefined());
    body.enqueue(new Uint8Array([1])); controller.abort(); await assertion;
    expect(create).not.toHaveBeenCalled();
    await expect(load()).resolves.toMatchObject({ labels });
    expect(create.mock.calls[0][0]).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("releases a session which completes initialization after cancellation", async () => {
    vi.stubGlobal("fetch", fetched());
    let finish!: (session: unknown) => void;
    create.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue({});
    const load = createLandmarkModelLoader("/models/example", 2), controller = new AbortController();
    const task = load(controller.signal); const assertion = expect(task).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(create).toHaveBeenCalledOnce());
    controller.abort(); await assertion;
    const release = vi.fn().mockResolvedValue(undefined); finish({ release });
    await vi.waitFor(() => expect(release).toHaveBeenCalledOnce());
    await expect(load()).resolves.toMatchObject({ labels });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("times out initialization separately and releases a late runtime", async () => {
    vi.useFakeTimers(); vi.stubGlobal("fetch", fetched());
    let finish!: (session: unknown) => void;
    create.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const task = createLandmarkModelLoader("/models/example", 2)();
    const assertion = expect(task).rejects.toThrow("initialization timed out");
    await vi.advanceTimersByTimeAsync(1); expect(create).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(90000); await assertion;
    const release = vi.fn().mockResolvedValue(undefined); finish({ release });
    await vi.advanceTimersByTimeAsync(0); expect(release).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
