import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AslV3Tracker, type AslV3TrackerInput, type AslV3TrackerOutput } from "../lib/asl-v3-tracker";
import type { VisionFrame } from "../lib/vision-types";

class FakeTrackerWorker {
  onmessage: ((event: MessageEvent<AslV3TrackerOutput>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  terminate = vi.fn();
  postMessage = vi.fn<(message: AslV3TrackerInput, transfer?: Transferable[]) => void>();

  emit(data: AslV3TrackerOutput) { this.onmessage?.({ data } as MessageEvent<AslV3TrackerOutput>); }
  frames() {
    return this.postMessage.mock.calls.flatMap(([message]) => message.type === "frame" ? [message] : []);
  }
}

let instance: FakeTrackerWorker;
const makeBitmap = () => ({ close: vi.fn() } as unknown as ImageBitmap);
const capture = vi.fn<typeof createImageBitmap>();
const film = () => ({ readyState: 2, currentTime: 1, videoWidth: 1920, videoHeight: 1080 } as HTMLVideoElement);
const frame: VisionFrame = { timestamp: 1000, hands: [], face: [], pose: [] };

beforeEach(() => {
  instance = new FakeTrackerWorker();
  capture.mockReset().mockImplementation(async () => makeBitmap());
  vi.stubGlobal("Worker", vi.fn(function () { return instance; }));
  vi.stubGlobal("createImageBitmap", capture);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function ready() {
  const onFrame = vi.fn(), onError = vi.fn();
  const pendingTracker = AslV3Tracker.create({ onFrame, onError });
  instance.emit({ type: "ready", delegate: "CPU" });
  return { tracker: await pendingTracker, onFrame, onError };
}

describe("ASL V3.1 camera tracking client", () => {
  it("bounds pending work to one bitmap and dispatches the newest video pixels with their own timestamp", async () => {
    const { tracker, onFrame } = await ready();
    const clock = vi.spyOn(performance, "now").mockReturnValue(1090);
    const video = film();
    tracker.schedule(video, 1000);
    video.currentTime = 2;
    tracker.schedule(video, 1033);
    video.currentTime = 3;
    tracker.schedule(video, 1066);
    await Promise.resolve();
    expect(capture).toHaveBeenCalledOnce();
    expect(capture).toHaveBeenCalledWith(video, { resizeWidth: 960, resizeHeight: 540, resizeQuality: "high" });
    expect(instance.frames()[0].timestamp).toBe(1000);
    instance.emit({ type: "frame", id: 1, frame, trackingMs: 60 });
    expect(onFrame).toHaveBeenCalledWith(frame, 60);
    await Promise.resolve();
    expect(instance.frames().map(message => message.timestamp)).toEqual([1000, 1090]);
    expect(capture).toHaveBeenCalledTimes(2);
    instance.emit({ type: "frame", id: 2, frame, trackingMs: 44 });
    clock.mockReturnValue(1300);
    tracker.schedule(video, 1300);
    expect(capture).toHaveBeenCalledTimes(2);
    tracker.close();
  });

  it("drops a late bitmap after reset and drops a late worker reply after another reset", async () => {
    const { tracker, onFrame } = await ready();
    const lateBitmap = makeBitmap();
    let resolveBitmap!: (bitmap: ImageBitmap) => void;
    capture.mockReturnValueOnce(new Promise(resolve => { resolveBitmap = resolve; }));
    const video = film();
    tracker.schedule(video, 1000);
    tracker.reset();
    resolveBitmap(lateBitmap);
    await Promise.resolve();
    expect(lateBitmap.close).toHaveBeenCalledOnce();
    expect(instance.frames()).toEqual([]);
    tracker.schedule(video, 1100);
    await Promise.resolve();
    tracker.reset();
    instance.emit({ type: "frame", id: 2, frame, trackingMs: 5 });
    expect(onFrame).not.toHaveBeenCalled();
    tracker.close();
    expect(instance.terminate).toHaveBeenCalledOnce();
  });

  it("terminates a tracking worker when startup is cancelled", async () => {
    const controller = new AbortController();
    const pending = AslV3Tracker.create({ onFrame: vi.fn(), onError: vi.fn(), signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(instance.terminate).toHaveBeenCalledOnce();
  });

  it("reports an unresponsive worker as fatal and releases its outstanding request", async () => {
    vi.useFakeTimers();
    const { tracker, onFrame, onError } = await ready();
    tracker.schedule(film(), 1000);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(8000);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "ASL tracking stopped responding" }), true);
    expect(instance.terminate).toHaveBeenCalledOnce();
    instance.emit({ type: "frame", id: 1, frame, trackingMs: 8000 });
    expect(onFrame).not.toHaveBeenCalled();
  });
});
