import { describe, expect, it } from "vitest";
import { VideoFrameGate } from "../lib/video-frame-gate";

describe("video frame identity and throttling", () => {
  it("accepts each presented frame only once, even if observed repeatedly", () => {
    const gate = new VideoFrameGate();
    expect(gate.observePresented(1)).toBe(true);
    expect(gate.takePresented(100)).toBe(true);
    expect(gate.takePresented(200)).toBe(false);
    expect(gate.observePresented(1)).toBe(false);
    expect(gate.takePresented(250)).toBe(false);
    expect(gate.observePresented(2)).toBe(true);
    expect(gate.takePresented(250)).toBe(true);
  });
  it("throttles fast video without reprocessing old frames", () => {
    const gate = new VideoFrameGate();
    expect(gate.observePresented(1)).toBe(true);
    expect(gate.takePresented(100)).toBe(true);
    expect(gate.observePresented(2)).toBe(true);
    expect(gate.takePresented(115)).toBe(false);
    expect(gate.observePresented(3)).toBe(true);
    expect(gate.takePresented(151)).toBe(true); // latest frame supersedes the skipped one
    expect(gate.takePresented(220)).toBe(false);
    expect(gate.observePresented(4)).toBe(true);
    expect(gate.takePresented(221)).toBe(true);
  });
  it("rejects stale, invalid and repeated presented-frame counters", () => {
    const gate = new VideoFrameGate();
    expect(gate.observePresented(7)).toBe(true);
    expect(gate.takePresented(100)).toBe(true);
    expect(gate.observePresented(6)).toBe(false);
    expect(gate.observePresented(7)).toBe(false);
    expect(gate.observePresented(NaN)).toBe(false);
    expect(gate.observePresented(-1)).toBe(false);
    expect(gate.takePresented(250)).toBe(false);
    expect(gate.observePresented(8)).toBe(true);
    expect(gate.takePresented(251)).toBe(true);
  });
  it("uses playback time only in the legacy fallback", () => {
    const gate = new VideoFrameGate();
    expect(gate.takeFallback(0, 100)).toBe(true);
    expect(gate.takeFallback(0, 300)).toBe(false);
    expect(gate.takeFallback(0.02, 315)).toBe(true);
    expect(gate.takeFallback(0.03, 350)).toBe(false);
    expect(gate.takeFallback(0.04, 365)).toBe(true);
    expect(gate.takeFallback(NaN, 400)).toBe(false);
  });
  it("resets frame identity after camera reconnect or language session restart", () => {
    const gate = new VideoFrameGate();
    gate.observePresented(500);
    expect(gate.takePresented(1000)).toBe(true);
    gate.reset();
    expect(gate.observePresented(1)).toBe(true);
    expect(gate.takePresented(1050)).toBe(true);
    gate.reset();
    expect(gate.takeFallback(0, 1100)).toBe(true);
  });
});
