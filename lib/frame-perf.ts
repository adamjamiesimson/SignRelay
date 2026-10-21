/** Rolling timing samples for the opt-in `?perf` readout used in device tests.
 * Holds numbers only (no frames or landmarks) and never leaves the page. */
export class RollingTimer {
  private samples: number[] = [];
  constructor(private readonly size = 120) {}
  record(ms: number) {
    if (!Number.isFinite(ms) || ms < 0) return;
    this.samples.push(ms);
    if (this.samples.length > this.size) this.samples.shift();
  }
  summary() {
    if (!this.samples.length) return null;
    const sorted = [...this.samples].sort((a, b) => a - b);
    const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
    return { count: sorted.length, p50: Math.round(at(0.5)), p95: Math.round(at(0.95)) };
  }
  reset() { this.samples = []; }
}
