// Own at most one captured frame waiting on the current worker request.
export class LatestFrame {
  constructor(discard, maxAgeMs = 120) {
    this.discard = discard;
    this.maxAgeMs = maxAgeMs;
  }
  offer(record, image) {
    this.clear("replaced");
    this.pending = { record, image };
  }
  take(now) {
    const next = this.pending;
    if (next && now - next.record.at > this.maxAgeMs) {
      this.clear("stale");
      return null;
    }
    this.pending = null;
    return next;
  }
  clear(reason) {
    if (!this.pending) return;
    const { record, image } = this.pending;
    this.pending = null;
    image.close();
    this.discard(record, reason);
  }
}
