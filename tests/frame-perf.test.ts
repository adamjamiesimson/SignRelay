import { describe, expect, it } from "vitest";
import { formatPerfReadout, RollingTimer } from "../lib/frame-perf";

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
