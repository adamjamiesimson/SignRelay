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
 * be forwarded because recognition was still busy (one in flight, one latest).
 * Optional fields are appended after the asset source. */
export function formatPerfReadout({ tracking, roundTrip, queueWait, seconds, analysed, session, assets, recognition, hands }: {
  tracking: Summary; roundTrip: Summary; queueWait: Summary; seconds: number; analysed: number;
  session: { offered: number; forwarded: number; replaced: number } | null; assets: string | null;
  recognition?: { state: string; recoveries: number } | null; hands?: { seen: number; frames: number } | null;
}) {
  const elapsed = Math.max(1, seconds);
  const dropped = session && session.offered ? `${session.replaced} dropped (${Math.round(100 * session.replaced / session.offered)}%)` : "— dropped";
  return `Tracking ${pair(tracking)} (p50/p95) · recognition round trip ${pair(roundTrip)} · queue wait ${pair(queueWait)}`
    + ` · ${session ? (session.forwarded / elapsed).toFixed(1) : "—"} forwarded/s, ${dropped}`
    + ` · ${(analysed / elapsed).toFixed(1)} frames analysed/s · assets ${assets ?? "—"}`
    + (recognition ? ` · recognition ${recognition.state}, ${recognition.recoveries} ${recognition.recoveries === 1 ? "recovery" : "recoveries"}` : "")
    + (hands ? ` · hand tracked in ${hands.frames ? Math.round(100 * hands.seen / hands.frames) : 0}% of frames` : "");
}

/** Manual gate MAN-1 (docs/gitex/demo-contract.json): the demo laptop must
 * analyse at least this many frames per second. YES is lost at 5–8 fps in
 * synthetic tests. */
export const MIN_ANALYSED_PER_SECOND = 10;

/** Warns only when throughput stays low for a whole trailing window, so a cold
 * start or one slow second is not reported. Counts only; nothing is stored. */
export class ThroughputMonitor {
  private ticks: { at: number; analysed: number }[] = [];
  constructor(private readonly windowSeconds = 5, private readonly minimum = MIN_ANALYSED_PER_SECOND) {}
  /** Call about once a second with the running total of analysed frames. */
  tick(analysedTotal: number, nowMs: number) {
    this.ticks.push({ at: nowMs, analysed: analysedTotal });
    while (this.ticks.length > 2 && nowMs - this.ticks[1].at >= this.windowSeconds * 1000) this.ticks.shift();
  }
  /** Frames analysed per second over the trailing window, once it is full. */
  rate() {
    const first = this.ticks[0], last = this.ticks.at(-1);
    if (!first || !last || last.at - first.at < this.windowSeconds * 1000) return null;
    return (last.analysed - first.analysed) / ((last.at - first.at) / 1000);
  }
  warning() {
    const rate = this.rate();
    return rate !== null && rate < this.minimum
      ? `Only ${rate.toFixed(1)} frames analysed per second over the last ${this.windowSeconds} s. The demo needs at least ${this.minimum}; close other apps or tabs and plug in the laptop before relying on recognition.`
      : null;
  }
  reset() { this.ticks = []; }
}
