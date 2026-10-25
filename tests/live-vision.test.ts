import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeSign } from "./fixtures/asl-motion";
const mocks = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("../lib/vision-engine", () => ({ VisionEngine: { create: mocks.create } }));
import { LiveVision } from "../lib/live-vision";
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
    await Promise.resolve();
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
  it("recovers a failed worker off-thread with CPU", async () => {
    const fallback = { process: vi.fn(() => frame), close: vi.fn(), assetSource: "self-hosted", delegate: "CPU", timings: { hands: 20, auxiliary: 0 } };
    mocks.create.mockResolvedValue(fallback);
    const live = await LiveVision.create(), port = Port.instances[0];
    const result = live.process({} as HTMLVideoElement, 1, vi.fn());
    await Promise.resolve(); port.onerror!();
    await expect(result).rejects.toThrow("interrupted"); await Promise.resolve();
    expect(Port.instances).toHaveLength(2);
    expect(Port.instances[1].postMessage).toHaveBeenCalledWith({ type: "init", accelerated: false });
    expect(mocks.create).not.toHaveBeenCalled();
    port.onerror!();
    expect(Port.instances).toHaveLength(2); // a terminated worker cannot restart its replacement
    expect(port.terminate).toHaveBeenCalledOnce(); live.close();
  });
  it("falls back when transferable tracking is unsupported", async () => {
    vi.stubGlobal("OffscreenCanvas", undefined);
    mocks.create.mockResolvedValue({ close: vi.fn(), assetSource: "self-hosted", delegate: "CPU" });
    const live = await LiveVision.create();
    expect(live.mode).toBe("main"); expect(Port.instances).toHaveLength(0); live.close();
  });
});
