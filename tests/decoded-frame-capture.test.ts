import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../lib/vision-engine", () => ({ VisionEngine: { create: vi.fn() } }));
import { LiveVision } from "../lib/live-vision";
import { MediaTrackingClock, OwnFrameSource, STALLED_TIMESTAMP_LIMIT } from "../lib/decoded-frame";

// Regression for a measured defect: callback metadata (and currentTime) can
// describe an older frame than the pixels a snapshot reads. These tests pin
// that tracked pixels are stamped with the VideoFrame's OWN timestamp, that
// every VideoFrame handle is closed exactly once, and that the previous
// behaviour remains the fallback when WebCodecs is unusable.

class Port {
  static all: Port[] = [];
  onmessage: ((e: { data: unknown }) => void) | null = null; onerror: (() => void) | null = null; onmessageerror = null;
  terminate = vi.fn();
  posted: { type: string; timestamp?: number; bitmap?: unknown }[] = [];
  postMessage = vi.fn((d: { type: string }) => {
    this.posted.push(d);
    if (d.type === "init") queueMicrotask(() => this.emit({ type: "ready", assetSource: "self-hosted", delegate: "CPU" }));
  });
  constructor() { Port.all.push(this); }
  emit(data: unknown) { this.onmessage?.({ data }); }
  complete(timestamp: number) {
    const frame = { timestamp, hands: [], face: [], pose: [] };
    this.emit({ type: "hands", frame, handsMs: 1 }); this.emit({ type: "result", frame, timings: { hands: 1, auxiliary: 0 } });
  }
}
let now = 100;
let currentMediaUs = 0;
let constructError: Error | null = null;
const frames: FakeVideoFrame[] = [];
class FakeVideoFrame {
  timestamp: number; close = vi.fn();
  constructor(readonly source: unknown) {
    if (constructError) throw constructError;
    this.timestamp = currentMediaUs; frames.push(this);
  }
}
const drawn: unknown[] = [];
function element() {
  let callback: VideoFrameRequestCallback | undefined;
  const v = { videoWidth: 640, videoHeight: 480,
    requestVideoFrameCallback: vi.fn((cb: VideoFrameRequestCallback) => { callback = cb; return 1; }), cancelVideoFrameCallback: vi.fn() };
  return { element: v as unknown as HTMLVideoElement,
    // metadataSeconds is what the callback claims; currentMediaUs is what the element shows.
    present: (metadataSeconds: number) => callback?.(now, { mediaTime: metadataSeconds, expectedDisplayTime: now, presentedFrames: 1 } as VideoFrameCallbackMetadata) };
}
beforeEach(() => {
  Port.all = []; frames.length = 0; drawn.length = 0; now = 100; currentMediaUs = 0; constructError = null;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.stubGlobal("Worker", Port);
  vi.stubGlobal("VideoFrame", FakeVideoFrame);
  vi.stubGlobal("createImageBitmap", vi.fn(async (source: unknown) => ({ source, close: vi.fn() })));
  vi.stubGlobal("OffscreenCanvas", class { width: number; height: number; last: unknown; constructor(w: number, h: number) { this.width = w; this.height = h; }
    getContext() { return { drawImage: (source: unknown) => { this.last = source; drawn.push(source); } }; }
    transferToImageBitmap() { return { source: this.last, close: vi.fn() }; } });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("OwnFrameSource", () => {
  it("disables itself when WebCodecs is missing or construction fails", () => {
    vi.stubGlobal("VideoFrame", undefined);
    expect(new OwnFrameSource().take({} as HTMLVideoElement, true)).toBeNull();
    vi.stubGlobal("VideoFrame", FakeVideoFrame);
    constructError = new Error("no frame");
    const source = new OwnFrameSource();
    expect(source.take({} as HTMLVideoElement, true)).toBeNull();
    expect(source.available).toBe(false);
    expect(source.disabledReason).toMatch(/no frame/);
  });
  it("treats repeated timestamps as repeats, then disables after a sustained stall", () => {
    const source = new OwnFrameSource();
    currentMediaUs = 1000;
    expect(source.take({} as HTMLVideoElement, true)?.repeat).toBe(false);
    for (let i = 1; i < STALLED_TIMESTAMP_LIMIT; i++) expect(source.take({} as HTMLVideoElement, true)?.repeat).toBe(true);
    expect(source.take({} as HTMLVideoElement, true)).toBeNull();
    expect(source.disabledReason).toMatch(/do not advance/);
    // Every handle created was closed or returned to the caller; the refused one is closed here.
    expect(frames.at(-1)!.close).toHaveBeenCalledOnce();
  });
  it("does not count repeats the caller did not observe as advancing", () => {
    const source = new OwnFrameSource();
    currentMediaUs = 1000; source.take({} as HTMLVideoElement, true);
    for (let i = 0; i < STALLED_TIMESTAMP_LIMIT * 2; i++) expect(source.take({} as HTMLVideoElement, false)?.repeat).toBe(true);
    expect(source.available).toBe(true);
  });
});

describe("MediaTrackingClock", () => {
  it("keeps camera intervals and re-anchors a backwards media clock", () => {
    const clock = new MediaTrackingClock();
    expect(clock.map(5000, 100)).toBe(100);
    expect(clock.map(5066.7, 400)).toBeCloseTo(166.7, 6); // anchor ignored once established
    expect(clock.map(10, 450)).toBe(450);                 // new stream: strictly increasing
    expect(clock.map(10, 451)).toBe(451);                 // never equal to the previous timestamp
    expect(clock.reanchored).toBe(2);
  });
});

describe("fingerspelling decoded-frame snapshot", () => {
  it("stamps pixels with the VideoFrame's own time when metadata describes an older frame", async () => {
    const live = await LiveVision.create(undefined, false, undefined, "fingerspelling"), v = element();
    await live.process(v.element, now, vi.fn());
    currentMediaUs = 2_000_000; v.present(2);
    // The callback still describes 2.0 s, but the element already shows 2.0667 s.
    now += 67; currentMediaUs = 2_066_667; v.present(2);
    const pending = live.process(v.element, now, vi.fn());
    const message = Port.all[0].posted.find(m => m.type === "frame")!;
    expect((message.bitmap as { source: unknown }).source).toBe(frames[1]);
    // Offset fixed at the first callback: expectedDisplayTime(100) - 2000 ms.
    expect(message.timestamp).toBeCloseTo(2066.667 - 2000 + 100, 3);
    Port.all[0].complete(message.timestamp!);
    await pending;
    expect(frames.every(f => f.close.mock.calls.length === 1)).toBe(true);
    live.close();
  });
  it("keeps sampling with increasing times when WebCodecs fails mid-stream in another clock domain", async () => {
    const live = await LiveVision.create(undefined, false, undefined, "fingerspelling"), v = element();
    await live.process(v.element, now, vi.fn());
    // WebCodecs reports a large media domain; callback metadata a small one.
    currentMediaUs = 900_000_000; v.present(1);
    now += 67; currentMediaUs = 900_066_667; v.present(1.067);
    const first = live.process(v.element, now, vi.fn());
    const sent = () => Port.all[0].posted.filter(m => m.type === "frame").map(m => m.timestamp!);
    Port.all[0].complete(sent()[0]); await first;
    constructError = new Error("transient");
    now += 67; v.present(1.133);
    expect(live.frameClock).toBe("callback");
    const second = live.process(v.element, now, vi.fn());
    expect(sent()).toHaveLength(2);
    // Without the lattice reset, slot(1.133 s) <= slot(900 066 s) would stall forever.
    expect(sent()[1]).toBeGreaterThan(sent()[0]);
    Port.all[0].complete(sent()[1]); await second; live.close();
  });
  it("falls back to callback metadata when WebCodecs is unavailable", async () => {
    vi.stubGlobal("VideoFrame", undefined);
    const live = await LiveVision.create(undefined, false, undefined, "fingerspelling"), v = element();
    await live.process(v.element, now, vi.fn());
    v.present(3);
    expect(live.frameClock).toBe("callback");
    const pending = live.process(v.element, now, vi.fn());
    const message = Port.all[0].posted.find(m => m.type === "frame")!;
    expect(drawn[0]).toBe(v.element);
    expect(message.timestamp).toBe(100);
    Port.all[0].complete(100); await pending; live.close();
  });
});

describe("word-mode capture clock", () => {
  async function words(policy: "pickup-tick" | "capture-time" = "capture-time") {
    const live = await LiveVision.create(undefined, false, undefined, "words");
    live.wordClockPolicy = policy;
    return { live, port: Port.all[0], v: element() };
  }
  it("keeps the established pick-up tick and element snapshot by default", async () => {
    const live = await LiveVision.create(undefined, false, undefined, "words"), port = Port.all[0], v = element();
    expect(live.wordClockPolicy).toBe("pickup-tick");
    expect(live.frameClock).toBe("pickup-tick");
    currentMediaUs = 5000;
    const pending = live.process(v.element, 777, vi.fn());
    await vi.waitFor(() => expect(port.posted.some(m => m.type === "frame")).toBe(true));
    const message = port.posted.find(m => m.type === "frame")!;
    expect(message.timestamp).toBe(777);
    expect((message.bitmap as { source: unknown }).source).toBe(v.element);
    expect(frames).toHaveLength(0);
    port.complete(777); await pending; live.close();
  });
  it("uses the frames' own capture intervals instead of animation ticks, and skips repeats", async () => {
    const { live, port, v } = await words();
    const stamps: number[] = [];
    for (const [tick, media] of [[100, 0], [180, 33_333], [190, 66_667], [300, 100_000]] as const) {
      now = tick; currentMediaUs = media;
      const pending = live.process(v.element, now, vi.fn());
      await vi.waitFor(() => expect(port.posted.filter(m => m.type === "frame")).toHaveLength(stamps.length + 1));
      stamps.push(port.posted.filter(m => m.type === "frame").at(-1)!.timestamp!);
      port.complete(stamps.at(-1)!); await pending;
    }
    // Animation ticks were 80, 10 and 110 ms apart; the camera intervals were 33.3 ms.
    expect(stamps.slice(1).map((t, i) => Math.round((t - stamps[i]) * 10) / 10)).toEqual([33.3, 33.3, 33.3]);
    // A repeated frame is not tracked twice under a new time.
    now = 400;
    expect(await live.process(v.element, now, vi.fn())).toBeNull();
    expect(live.stats.repeated).toBe(1);
    expect(port.posted.filter(m => m.type === "frame")).toHaveLength(4);
    expect(frames.every(f => f.close.mock.calls.length === 1)).toBe(true);
    live.close();
  });
  it("keeps the previous animation-time stamps when VideoFrame construction fails", async () => {
    constructError = new Error("unsupported");
    const { live, port, v } = await words();
    const pending = live.process(v.element, 1234, vi.fn());
    await vi.waitFor(() => expect(port.posted.some(m => m.type === "frame")).toBe(true));
    const message = port.posted.find(m => m.type === "frame")!;
    expect(message.timestamp).toBe(1234);
    expect((message.bitmap as { source: unknown }).source).toBe(v.element);
    port.complete(1234); await pending;
    expect(live.frameClock).toBe("callback");
    live.close();
  });
  it("never sends a smaller time when the opt-in clock loses WebCodecs mid-stream", async () => {
    const { live, port, v } = await words();
    now = 100; currentMediaUs = 50_000_000;
    let pending = live.process(v.element, now, vi.fn());
    await vi.waitFor(() => expect(port.posted.filter(m => m.type === "frame")).toHaveLength(1));
    port.complete(100); await pending;
    now = 180; currentMediaUs = 50_200_000; // capture-time 300 > tick 180
    pending = live.process(v.element, now, vi.fn());
    await vi.waitFor(() => expect(port.posted.filter(m => m.type === "frame")).toHaveLength(2));
    port.complete(300); await pending;
    constructError = new Error("transient"); now = 200;
    pending = live.process(v.element, now, vi.fn());
    await vi.waitFor(() => expect(port.posted.filter(m => m.type === "frame")).toHaveLength(3));
    expect(port.posted.filter(m => m.type === "frame").map(m => m.timestamp)).toEqual([100, 300, 301]);
    port.complete(301); await pending; live.close();
  });
  it("closes the VideoFrame when capture is closed while the bitmap is pending", async () => {
    let release!: (value: unknown) => void;
    vi.stubGlobal("createImageBitmap", vi.fn(() => new Promise(resolve => { release = resolve; })));
    const { live, v } = await words();
    currentMediaUs = 5000;
    const pending = live.process(v.element, now, vi.fn());
    live.close();
    const bitmap = { close: vi.fn() };
    release(bitmap);
    expect(await pending).toBeNull();
    expect(frames[0].close).toHaveBeenCalledOnce();
    expect(bitmap.close).toHaveBeenCalledOnce();
  });
});
