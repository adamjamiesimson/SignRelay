import { afterEach, describe, expect, it, vi } from "vitest";
import { loadVideoData, seekDecodedFrame } from "../scripts/diagnostics/video-frame-step";

class Video extends EventTarget {
  currentTime = 0;
  readyState = 2;
  seeking = true;
  src = "";
  error: { message: string } | null = null;
  callbacks = new Map<number, VideoFrameRequestCallback>();
  nextId = 0;
  load() {}
  requestVideoFrameCallback(callback: VideoFrameRequestCallback) {
    this.callbacks.set(++this.nextId, callback); return this.nextId;
  }
  cancelVideoFrameCallback(id: number) { this.callbacks.delete(id); }
  frame(mediaTime: number, presentationTime = performance.now() + 1) {
    const callbacks = [...this.callbacks.values()]; this.callbacks.clear();
    for (const callback of callbacks) callback(performance.now(), { mediaTime, presentationTime } as VideoFrameCallbackMetadata);
  }
  seeked() { this.seeking = false; this.dispatchEvent(new Event("seeked")); }
  element() { return this as unknown as HTMLVideoElement; }
}
afterEach(() => vi.useRealTimers());

describe("decoded video stepping", () => {
  it.each(["callback-first", "seek-first"])("requires both seek completion and a presented frame: %s", async order => {
    const video = new Video(); let settled = false;
    const result = seekDecodedFrame(video.element(), 0.15).then(value => { settled = true; return value; });
    if (order === "callback-first") video.frame(0.133); else video.seeked();
    await Promise.resolve(); expect(settled).toBe(false);
    if (order === "callback-first") video.seeked(); else video.frame(0.133);
    expect(await result).toBe(0.133); // Actual decoded PTS, never the seek target.
    expect(video.callbacks.size).toBe(0);
  });
  it("does not replace a duplicate decoded PTS with a new timestamp", async () => {
    const video = new Video();
    const result = seekDecodedFrame(video.element(), 0.05);
    video.seeked(); video.frame(0);
    expect(await result).toBe(0);
  });
  it("ignores a queued presentation from before this seek", async () => {
    const video = new Video(); let settled = false;
    const result = seekDecodedFrame(video.element(), 0.2).then(value => { settled = true; return value; });
    video.seeked(); video.frame(0.1, -1); await Promise.resolve();
    expect(settled).toBe(false); expect(video.callbacks.size).toBe(1);
    video.frame(0.2); expect(await result).toBe(0.2);
  });
  it.each(["seek-only", "callback-only", "neither"])("fails rather than crediting incomplete delivery: %s", async kind => {
    vi.useFakeTimers(); const video = new Video();
    const result = seekDecodedFrame(video.element(), 0.2, { timeoutMs: 20 });
    const assertion = expect(result).rejects.toThrow(/Video frame delivery timed out.*target=0.200000/);
    if (kind === "seek-only") video.seeked();
    if (kind === "callback-only") video.frame(0.2);
    await vi.advanceTimersByTimeAsync(20); await assertion;
    expect(video.callbacks.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
  });
  it("keeps the original deadline when stale callbacks arrive", async () => {
    vi.useFakeTimers(); const video = new Video();
    const result = seekDecodedFrame(video.element(), 0.2, { timeoutMs: 20 });
    const assertion = expect(result).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(15); video.frame(0.1, -1);
    await vi.advanceTimersByTimeAsync(5); await assertion; expect(video.callbacks.size).toBe(0);
  });
  it.each(["error", "emptied", "abort"])("releases callbacks and listeners on %s", async event => {
    const video = new Video(), controller = new AbortController();
    const result = seekDecodedFrame(video.element(), 0.2, { signal: controller.signal });
    const assertion = expect(result).rejects.toThrow(event === "error" ? "decode" : event === "emptied" ? "released" : "stopped");
    if (event === "abort") controller.abort(new Error("Diagnostic stopped")); else video.dispatchEvent(new Event(event));
    await assertion; expect(video.callbacks.size).toBe(0);
    // Late events cannot revive a cancelled sample or leave pending callbacks.
    video.seeked(); video.frame(0.2); expect(video.callbacks.size).toBe(0);
  });
  it("rejects invalid metadata and already-cancelled work", async () => {
    const video = new Video(); const bad = seekDecodedFrame(video.element(), 0.2);
    video.frame(NaN); await expect(bad).rejects.toThrow("invalid source-frame metadata");
    const controller = new AbortController(); controller.abort(new Error("stopped"));
    await expect(seekDecodedFrame(video.element(), 0.3, { signal: controller.signal })).rejects.toThrow("stopped");
    expect(video.callbacks.size).toBe(0);
  });
  it("cannot revive a cancelled sample through an already-queued callback", async () => {
    const video = new Video(), controller = new AbortController();
    const result = seekDecodedFrame(video.element(), 0.2, { signal: controller.signal });
    const queued = [...video.callbacks.values()][0];
    controller.abort(new Error("stopped")); await expect(result).rejects.toThrow("stopped");
    queued(performance.now(), { mediaTime: 0.2, presentationTime: performance.now() } as VideoFrameCallbackMetadata);
    expect(video.callbacks.size).toBe(0);
  });
});

describe("bounded video loading", () => {
  it("loads the selected source and removes event handlers after completion", async () => {
    const video = new Video(); const result = loadVideoData(video.element(), "blob:local");
    expect(video.src).toBe("blob:local"); video.dispatchEvent(new Event("loadeddata")); await result;
  });
  it.each(["timeout", "abort", "error"])("rejects a load interrupted by %s", async reason => {
    vi.useFakeTimers(); const video = new Video(), controller = new AbortController();
    const result = loadVideoData(video.element(), "blob:local", { signal: controller.signal, timeoutMs: 20 });
    const assertion = expect(result).rejects.toThrow(reason === "timeout" ? "timed out" : reason === "abort" ? "stopped" : "decode");
    if (reason === "timeout") await vi.advanceTimersByTimeAsync(20);
    else if (reason === "abort") controller.abort(new Error("Diagnostic stopped"));
    else video.dispatchEvent(new Event("error"));
    await assertion; expect(vi.getTimerCount()).toBe(0);
  });
});
