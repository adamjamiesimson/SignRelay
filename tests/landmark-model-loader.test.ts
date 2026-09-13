import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLandmarkModelLoader } from "../lib/landmark-model-loader";

const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("onnxruntime-web", () => ({ InferenceSession: { create } }));
const labels = ["HELLO", "THANK YOU"];
const response = (data: unknown = labels) => ({ ok: true, json: async () => data });
beforeEach(() => create.mockReset());
afterEach(() => vi.unstubAllGlobals());

describe("landmark model loading", () => {
  it("shares concurrent loads and caches the successful model", async () => {
    const session = { run: vi.fn() };
    create.mockResolvedValue(session);
    const fetch = vi.fn().mockResolvedValue(response());
    vi.stubGlobal("fetch", fetch);
    const load = createLandmarkModelLoader("/models/example", 2);
    const [a, b] = await Promise.all([load(), load()]);
    expect(a).toBe(b);
    expect(await load()).toBe(a);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);
    expect(a).toEqual({ session, labels });
  });

  it("recovers from a failed label download without creating an orphan session", async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(response());
    vi.stubGlobal("fetch", fetch);
    create.mockResolvedValue({});
    const load = createLandmarkModelLoader("/models/example", 2);
    await expect(load()).rejects.toThrow("offline");
    expect(create).not.toHaveBeenCalled();
    await expect(load()).resolves.toMatchObject({ labels });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("retries failed session creation on the next worker attempt", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response()));
    create.mockRejectedValueOnce(new Error("model download failed")).mockResolvedValue({});
    const load = createLandmarkModelLoader("/models/example", 2);
    await expect(load()).rejects.toThrow("model download failed");
    await expect(load()).resolves.toMatchObject({ labels });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it.each([null, {}, ["HELLO"], ["HELLO", ""], ["HELLO", 42], ["HELLO", "HELLO"]])(
    "rejects invalid label contracts before allocating a model: %j", async data => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(data)));
      await expect(createLandmarkModelLoader("/models/example", 2)()).rejects.toThrow("distinct, nonempty");
      expect(create).not.toHaveBeenCalled();
    },
  );

  it("keeps language caches independent", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response()));
    create.mockResolvedValue({});
    await Promise.all([
      createLandmarkModelLoader("/models/bsl", 2)(),
      createLandmarkModelLoader("/models/isl", 2)(),
    ]);
    expect(create.mock.calls.map(call => call[0])).toEqual(["/models/bsl/model.onnx", "/models/isl/model.onnx"]);
  });
});
