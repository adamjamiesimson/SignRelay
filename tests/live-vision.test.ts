import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeSign } from "./fixtures/asl-motion";
const mocks = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("../lib/vision-engine", () => ({ VisionEngine: { create: mocks.create } }));
import { BitmapCaptureTimeout, LiveVision } from "../lib/live-vision";
const frame = makeSign("SORRY")[0];
class Port {
  static instances: Port[] = [];
  static hangGpu = false;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminate = vi.fn();
  postMessage = vi.fn((data: { type: string; accelerated?: boolean }) => {
    if (data.type === "init") queueMicrotask(() => this.emit(Port.hangGpu && data.accelerated
      ? { type: "warming" } : { type: "ready", assetSource: "self-hosted", delegate: data.accelerated ? "GPU" : "CPU" }));
  });
  constructor() { Port.instances.push(this); }
  emit(data: unknown) { this.onmessage?.({ data }); }
}
beforeEach(() => {
  vi.resetAllMocks(); Port.instances = []; Port.hangGpu = false;
  vi.stubGlobal("Worker", Port); vi.stubGlobal("OffscreenCanvas", class {});
  vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ close: vi.fn() })));
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("bounded tracking lane", () => {
  it("terminates startup immediately when the camera request is cancelled", async () => {
    Port.hangGpu = true;
    const controller = new AbortController();
    const starting = LiveVision.create(undefined, true, controller.signal);
    controller.abort();
    await expect(starting).rejects.toThrow();
    expect(Port.instances).toHaveLength(1);
    expect(Port.instances[0].terminate).toHaveBeenCalledOnce();
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("discards a bitmap if the worker fails during asynchronous capture", async () => {
    let finish!: (bitmap: ImageBitmap) => void;
    vi.mocked(createImageBitmap).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const live = await LiveVision.create(), draw = vi.fn(), bitmap = { close: vi.fn() };
    const pending = live.process({} as HTMLVideoElement, 1, draw);
    Port.instances[0].onerror!();
    finish(bitmap as unknown as ImageBitmap);
    expect(await pending).toBeNull();
    expect(bitmap.close).toHaveBeenCalledOnce();
    expect(draw).not.toHaveBeenCalled();
    expect(Port.instances[1].postMessage.mock.calls.every(([message]) => message.type === "init")).toBe(true);
    live.close();
  });
  it("terminates a GPU that hangs at warmup and starts a CPU worker before opening the lane", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    Port.hangGpu = true;
    const starting = LiveVision.create();
    await Promise.resolve(); await vi.advanceTimersByTimeAsync(4001);
    const live = await starting;
    expect(live.delegate).toBe("CPU"); expect(live.mode).toBe("worker");
    expect(Port.instances[0].terminate).toHaveBeenCalledOnce();
    expect(Port.instances).toHaveLength(2); live.close();
  });
  it("drops frames during capture/inference and draws hands before auxiliary completion", async () => {
    const live = await LiveVision.create(), port = Port.instances[0], draw = vi.fn();
    const first = live.process({} as HTMLVideoElement, 1, draw);
    expect(await live.process({} as HTMLVideoElement, 2, draw)).toBeNull();
    await Promise.resolve();
    expect(createImageBitmap).toHaveBeenCalledTimes(1);
    port.emit({ type: "hands", frame, handsMs: 12 });
    expect(draw).toHaveBeenCalledWith(frame); expect(live.busy).toBe(true);
    expect(await live.process({} as HTMLVideoElement, 3, draw)).toBeNull();
    port.emit({ type: "result", frame, timings: { hands: 12, auxiliary: 45 } });
    expect(await first).toBe(frame); expect(live.busy).toBe(false);
    const newest = live.process({} as HTMLVideoElement, 100, draw);
    await vi.waitFor(() => expect(port.postMessage).toHaveBeenCalledTimes(3));
    const messages = port.postMessage.mock.calls.map(([m]) => m as { type: string; timestamp: number });
    expect(messages.filter(m => m.type === "frame").map(m => m.timestamp)).toEqual([1, 100]);
    live.close(); expect(await newest).toBeNull();
  });
  it("closes a bitmap captured after stop and never sends stale output", async () => {
    let finish!: (bitmap: ImageBitmap) => void;
    vi.mocked(createImageBitmap).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const live = await LiveVision.create(), bitmap = { close: vi.fn() }, draw = vi.fn();
    const result = live.process({} as HTMLVideoElement, 1, draw);
    live.close(); finish(bitmap as unknown as ImageBitmap);
    expect(await result).toBeNull(); expect(bitmap.close).toHaveBeenCalledOnce(); expect(draw).not.toHaveBeenCalled();
    expect(Port.instances[0].postMessage.mock.calls).toHaveLength(1);
  });
  it("bounds a hung native bitmap conversion and disposes its late bitmap", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let finish!: (bitmap: ImageBitmap) => void;
    vi.mocked(createImageBitmap).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const live = await LiveVision.create(), draw = vi.fn(), bitmap = { close: vi.fn() };
    const result = live.process({} as HTMLVideoElement, 1, draw);
    const assertion = expect(result).rejects.toBeInstanceOf(BitmapCaptureTimeout);
    await vi.advanceTimersByTimeAsync(10000);
    await assertion;
    expect(Port.instances[0].terminate).toHaveBeenCalledOnce();
    expect(await live.process({} as HTMLVideoElement, 2, draw)).toBeNull();
    expect(createImageBitmap).toHaveBeenCalledOnce();
    finish(bitmap as unknown as ImageBitmap);
    await Promise.resolve();
    expect(bitmap.close).toHaveBeenCalledOnce();
    expect(draw).not.toHaveBeenCalled();
  });
  it("recovers a failed worker off-thread with CPU", async () => {
    const fallback = { process: vi.fn(() => frame), close: vi.fn(), assetSource: "self-hosted", delegate: "CPU", timings: { hands: 20, auxiliary: 0 } };
    mocks.create.mockResolvedValue(fallback);
    const live = await LiveVision.create(), port = Port.instances[0];
    const result = live.process({} as HTMLVideoElement, 1, vi.fn());
    await vi.waitFor(() => expect(port.postMessage).toHaveBeenCalledTimes(2));
    port.onerror!();
    await expect(result).rejects.toThrow("interrupted"); await Promise.resolve();
    expect(Port.instances).toHaveLength(2);
    expect(Port.instances[1].postMessage).toHaveBeenCalledWith({ type: "init", accelerated: false });
    expect(mocks.create).not.toHaveBeenCalled();
    port.onerror!();
    expect(Port.instances).toHaveLength(2); // a terminated worker cannot restart its replacement
    expect(port.terminate).toHaveBeenCalledOnce(); live.close();
  });
  it("reports an interruption when the worker fails during capture, though the frame resolves null", async () => {
    let finish!: (bitmap: ImageBitmap) => void;
    vi.mocked(createImageBitmap).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const live = await LiveVision.create(), interrupted = vi.fn();
    live.onInterrupt = interrupted;
    const pending = live.process({} as HTMLVideoElement, 1, vi.fn());
    Port.instances[0].onerror!();
    expect(interrupted).toHaveBeenCalledOnce();
    finish({ close: vi.fn() } as unknown as ImageBitmap);
    expect(await pending).toBeNull();
    live.close();
  });
  it("stops after repeated worker crashes without waiting for a frame to reject", async () => {
    const live = await LiveVision.create(), failed = vi.fn(), interrupted = vi.fn();
    live.onFailure = failed;
    live.onInterrupt = interrupted;
    for (let i = 0; i < 3; i++) {
      Port.instances[i].emit(null);
      await vi.waitFor(() => expect(live.busy).toBe(false));
    }
    expect(Port.instances).toHaveLength(3);
    expect(interrupted).toHaveBeenCalledTimes(2);
    expect(failed).toHaveBeenCalledOnce();
    expect(Port.instances.every(port => port.terminate.mock.calls.length === 1)).toBe(true);
    expect(await live.process({} as HTMLVideoElement, 1, vi.fn())).toBeNull();
  });
  it("reports an interruption after hands were painted, before the frame rejects", async () => {
    const live = await LiveVision.create(), port = Port.instances[0], order: string[] = [];
    live.onInterrupt = () => order.push("interrupt");
    const result = live.process({} as HTMLVideoElement, 1, () => order.push("hands"));
    await vi.waitFor(() => expect(port.postMessage).toHaveBeenCalledTimes(2));
    port.emit({ type: "hands", frame, handsMs: 12 });
    port.emit({ type: "error", message: "aux inference failed" });
    await expect(result).rejects.toThrow("aux inference failed");
    expect(order).toEqual(["hands", "interrupt"]);
    live.close();
  });
  it("rejects broken landmarks before they can reach the canvas", async () => {
    const live = await LiveVision.create(), port = Port.instances[0], draw = vi.fn();
    try {
      const result = live.process({} as HTMLVideoElement, 1, draw);
      const rejected = expect(result).rejects.toThrow("Invalid tracking landmarks");
      await vi.waitFor(() => expect(port.postMessage).toHaveBeenCalledTimes(2));
      port.emit({ type: "hands", frame: { ...frame, hands: [{ landmarks: [null] }] }, handsMs: 12 });
      await rejected;
      expect(draw).not.toHaveBeenCalled();
      expect(port.terminate).toHaveBeenCalledOnce();
    } finally { live.close(); }
  });
  it("reports an interruption when a frame times out", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const live = await LiveVision.create(), interrupted = vi.fn();
    live.onInterrupt = interrupted;
    const result = live.process({} as HTMLVideoElement, 1, vi.fn());
    const settled = expect(result).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(8001);
    await settled;
    expect(interrupted).toHaveBeenCalledOnce();
    live.close();
  });
  it("does not report an interruption for a deliberate stop", async () => {
    const live = await LiveVision.create(), interrupted = vi.fn();
    live.onInterrupt = interrupted;
    const result = live.process({} as HTMLVideoElement, 1, vi.fn());
    await Promise.resolve();
    live.close(); Port.instances[0].onerror?.();
    expect(await result).toBeNull();
    expect(interrupted).not.toHaveBeenCalled();
  });
  it("falls back when transferable tracking is unsupported", async () => {
    vi.stubGlobal("OffscreenCanvas", undefined);
    mocks.create.mockResolvedValue({ close: vi.fn(), assetSource: "self-hosted", delegate: "CPU" });
    const live = await LiveVision.create();
    expect(live.mode).toBe("main"); expect(Port.instances).toHaveLength(0); live.close();
    expect(mocks.create).toHaveBeenCalledWith(undefined, false);
  });
});
