import { describe, expect, it } from "vitest";
import { formatPerfReadout, MIN_ANALYSED_PER_SECOND, RollingTimer, ThroughputMonitor } from "../lib/frame-perf";

describe("rolling timing readout", () => {
  it("reports p50/p95 over a bounded window and ignores invalid samples", () => {
    const timer = new RollingTimer(10);
    for (let ms = 1; ms <= 20; ms++) timer.record(ms);
    timer.record(Number.NaN); timer.record(-5);
    expect(timer.summary()).toEqual({ count: 10, p50: 16, p95: 20 });
    timer.reset();
    expect(timer.summary()).toBeNull();
  });
});

describe("extended ?perf readout", () => {
  it("reports p50/p95 timings, forwarded rate and dropped share, keeping the self-hosted asset suffix", () => {
    const line = formatPerfReadout({ tracking: { count: 10, p50: 20, p95: 40 }, roundTrip: { count: 10, p50: 3, p95: 9 },
      queueWait: { count: 10, p50: 0, p95: 12 }, seconds: 10, analysed: 60, session: { offered: 200, forwarded: 60, replaced: 140 }, assets: "self-hosted" });
    expect(line).toBe("Tracking 20/40 ms (p50/p95) · recognition round trip 3/9 ms · queue wait 0/12 ms · 6.0 forwarded/s, 140 dropped (70%) · 6.0 frames analysed/s · assets self-hosted");
    expect(line).toMatch(/frames analysed\/s · assets self-hosted/);
  });
  it("shows dashes before any data", () => {
    expect(formatPerfReadout({ tracking: null, roundTrip: null, queueWait: null, seconds: 0, analysed: 0, session: null, assets: null }))
      .toBe("Tracking — (p50/p95) · recognition round trip — · queue wait — · — forwarded/s, — dropped · 0.0 frames analysed/s · assets —");
  });
});

describe("operator diagnostics", () => {
  it("appends recognition state, recovery attempts and hand-tracking share after the asset source", () => {
    const line = formatPerfReadout({ tracking: null, roundTrip: null, queueWait: null, seconds: 10, analysed: 120, session: null, assets: "self-hosted",
      recognition: { state: "recovering", recoveries: 1 }, hands: { seen: 30, frames: 120 } });
    expect(line).toMatch(/frames analysed\/s · assets self-hosted · recognition recovering, 1 recovery · hand tracked in 25% of frames$/);
    expect(formatPerfReadout({ tracking: null, roundTrip: null, queueWait: null, seconds: 1, analysed: 0, session: null, assets: null,
      recognition: { state: "running", recoveries: 2 }, hands: { seen: 0, frames: 0 } })).toMatch(/running, 2 recoveries · hand tracked in 0% of frames$/);
  });

  it("warns only after a full window below the MAN-1 minimum", () => {
    expect(MIN_ANALYSED_PER_SECOND).toBe(10);
    const monitor = new ThroughputMonitor(5);
    let total = 0;
    // Cold start: nothing analysed for 3 s, then 12/s. No warning until a full window exists, none once it is healthy.
    for (let second = 0; second <= 3; second++) { monitor.tick(total, second * 1000); expect(monitor.warning()).toBeNull(); }
    for (let second = 4; second <= 12; second++) { total += 12; monitor.tick(total, second * 1000); }
    expect(monitor.rate()).toBeCloseTo(12);
    expect(monitor.warning()).toBeNull();
    // Sustained 6/s for a whole window.
    for (let second = 13; second <= 18; second++) { total += 6; monitor.tick(total, second * 1000); }
    expect(monitor.rate()).toBeCloseTo(6);
    expect(monitor.warning()).toMatch(/^Only 6\.0 frames analysed per second over the last 5 s\. The demo needs at least 10/);
    // Recovers once the window is healthy again.
    for (let second = 19; second <= 24; second++) { total += 15; monitor.tick(total, second * 1000); }
    expect(monitor.warning()).toBeNull();
    monitor.reset();
    expect(monitor.rate()).toBeNull();
  });
});
