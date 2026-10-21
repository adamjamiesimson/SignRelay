import { describe, expect, it } from "vitest";
import { RollingTimer } from "../lib/frame-perf";

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
