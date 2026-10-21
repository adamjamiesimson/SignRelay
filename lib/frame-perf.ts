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

type Summary = ReturnType<RollingTimer["summary"]>;
const pair = (summary: Summary) => summary ? `${summary.p50}/${summary.p95} ms` : "—";

/** The ?perf line. "dropped" counts camera frames superseded before they could
 * be forwarded because recognition was still busy (one in flight, one latest). */
export function formatPerfReadout({ tracking, roundTrip, queueWait, seconds, analysed, session, assets }: {
  tracking: Summary; roundTrip: Summary; queueWait: Summary; seconds: number; analysed: number;
  session: { offered: number; forwarded: number; replaced: number } | null; assets: string | null;
}) {
  const elapsed = Math.max(1, seconds);
  const dropped = session && session.offered ? `${session.replaced} dropped (${Math.round(100 * session.replaced / session.offered)}%)` : "— dropped";
  return `Tracking ${pair(tracking)} (p50/p95) · recognition round trip ${pair(roundTrip)} · queue wait ${pair(queueWait)}`
    + ` · ${session ? (session.forwarded / elapsed).toFixed(1) : "—"} forwarded/s, ${dropped}`
    + ` · ${(analysed / elapsed).toFixed(1)} frames analysed/s · assets ${assets ?? "—"}`;
}
