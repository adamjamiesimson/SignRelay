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
let workers: FakeTrackerWorker[];
const makeBitmap = () => ({ close: vi.fn() } as unknown as ImageBitmap);
const capture = vi.fn<typeof createImageBitmap>();
const film = () => ({ readyState: 2, currentTime: 1, videoWidth: 1920, videoHeight: 1080 } as HTMLVideoElement);
const frame: VisionFrame = { timestamp: 1000, hands: [], face: [], pose: [] };

beforeEach(() => {
  workers = [];
  capture.mockReset().mockImplementation(async () => makeBitmap());
  vi.stubGlobal("Worker", vi.fn(function () {
    const worker = new FakeTrackerWorker();
    workers.push(worker);
    instance ??= worker;
    return worker;
  }));
  // Single-worker behaviour unless a test opts into the parallel pose worker.
  vi.stubGlobal("navigator", { hardwareConcurrency: 2 });
  vi.stubGlobal("createImageBitmap", capture);
});

afterEach(() => {
  instance = undefined as unknown as FakeTrackerWorker;
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

  describe("parallel pose worker", () => {
    const features = () => new Float32Array(86 * 3).fill(Number.NaN);
    const handFrame = (timestamp: number): VisionFrame => ({ timestamp, hands: [], face: [], pose: [], aslV3Features: features() });
    const poseReply = (id: number, timestamp: number) => ({ type: "pose" as const, id, timestamp,
      points: [{ x: 0.5, y: 0.4, z: 0 }], slots: new Float32Array(13 * 3).fill(0.25) });

    async function readyWithPose() {
      vi.stubGlobal("navigator", { hardwareConcurrency: 8 });
      const started = await ready();
      const pose = workers[1];
      expect(pose.postMessage).toHaveBeenCalledWith({ type: "init", delegate: "CPU", role: "pose" });
      return { ...started, pose };
    }

    it("tracks pose in parallel on alternate frames and merges it into the hand frame", async () => {
      const { tracker, onFrame, pose } = await readyWithPose();
      const video = film();
      tracker.schedule(video, 1000);
      await Promise.resolve();
      // Not ready yet: the tracking worker still runs pose itself.
      expect(instance.frames()[0].externalPose).toBe(false);
      expect(pose.frames()).toEqual([]);
      instance.emit({ type: "frame", id: 1, frame: handFrame(1000), trackingMs: 50 });
      pose.emit({ type: "ready", delegate: "CPU" });

      vi.spyOn(performance, "now").mockReturnValue(1100);
      video.currentTime = 2;
      tracker.schedule(video, 1100);
      await Promise.resolve();
      await Promise.resolve();
      expect(instance.frames()[1].externalPose).toBe(true);
      expect(pose.frames().map(message => message.timestamp)).toEqual([1100]);
      expect(capture).toHaveBeenCalledTimes(3); // two camera captures + one copy for the pose worker
      pose.emit(poseReply(2, 1100));
      const tracked = handFrame(1100);
      instance.emit({ type: "frame", id: 2, frame: tracked, trackingMs: 50 });
      expect(onFrame).toHaveBeenLastCalledWith(tracked, 50);
      expect(tracked.pose).toEqual([{ x: 0.5, y: 0.4, z: 0 }]);
      expect(Array.from(tracked.aslV3Features!.slice(42 * 3, 55 * 3))).toEqual(new Array(39).fill(0.25));
      expect(Number.isNaN(tracked.aslV3Features![0])).toBe(true);

      // The next frame reuses that pose without sending another pose request.
      video.currentTime = 3;
      tracker.schedule(video, 1170);
      await Promise.resolve();
      expect(instance.frames()[2].externalPose).toBe(true);
      expect(pose.frames()).toHaveLength(1);
      tracker.close();
      expect(pose.terminate).toHaveBeenCalledOnce();
    });

    it("never merges pose from before a reset", async () => {
      const { tracker, onFrame, pose } = await readyWithPose();
      pose.emit({ type: "ready", delegate: "CPU" });
      const video = film();
      tracker.schedule(video, 1000);
      await Promise.resolve();
      await Promise.resolve();
      tracker.reset();
      pose.emit(poseReply(1, 1000));
      instance.emit({ type: "frame", id: 1, frame: handFrame(1000), trackingMs: 40 }); // stale: dropped
      expect(onFrame).not.toHaveBeenCalled();
      vi.spyOn(performance, "now").mockReturnValue(1100);
      video.currentTime = 2;
      tracker.schedule(video, 1100);
      await Promise.resolve();
      const tracked = handFrame(1100);
      instance.emit({ type: "frame", id: 2, frame: tracked, trackingMs: 40 });
      expect(onFrame).toHaveBeenCalledWith(tracked, 40);
      expect(tracked.pose).toEqual([]);
      tracker.close();
    });

    it("falls back to in-worker pose when the pose worker fails, without a camera error", async () => {
      const { tracker, onError, pose } = await readyWithPose();
      pose.emit({ type: "ready", delegate: "CPU" });
      pose.emit({ type: "error", message: "pose crashed" });
      expect(pose.terminate).toHaveBeenCalledOnce();
      tracker.schedule(film(), 1000);
      await Promise.resolve();
      expect(instance.frames()[0].externalPose).toBe(false);
      expect(onError).not.toHaveBeenCalled();
      tracker.close();
    });

    it("stays single-worker on machines with fewer cores", async () => {
      vi.stubGlobal("navigator", { hardwareConcurrency: 2 });
      const { tracker } = await ready();
      expect(workers).toHaveLength(1);
      tracker.close();
    });
  });
});
