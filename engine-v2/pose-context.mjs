// Pose is auxiliary. Keep one request in flight and use source-time-valid
// context. A delayed or failed pose worker cannot stall hands.
export class PoseContext {
  constructor(worker) {
    this.worker = worker;
    this.requestedAt = -Infinity;
    this.completedAt = -Infinity;
    this.points = [];
    this.ready = false;
    this.failed = false;
    this.busy = false;
    worker.onerror = () => this.fail();
    worker.onmessageerror = () => this.fail();
    worker.onmessage = ({ data }) => {
      if (data.type === "ready") { this.ready = true; return; }
      if (data.type !== "pose" || data.timestamp !== this.requestedAt) { this.fail(); return; }
      this.completedAt = data.timestamp;
      this.points = data.points;
      this.duration = data.duration;
      this.busy = false;
    };
  }
  fail() {
    this.failed = true;
    this.ready = false;
    this.busy = false;
    this.points = [];
    this.worker.terminate();
  }
  offer(timestamp, snapshot, now = performance.now()) {
    if (this.busy && now - this.requestTime > 1800) this.fail();
    if (!this.ready || this.busy || timestamp - this.requestedAt < 220) return false;
    let image;
    try {
      image = snapshot();
      this.worker.postMessage({ image, timestamp }, [image]);
    } catch {
      image?.close();
      this.fail();
      return false;
    }
    this.requestedAt = timestamp;
    this.requestTime = now;
    this.busy = true;
    return true;
  }
  read(timestamp) {
    const age = timestamp - this.completedAt;
    return age >= 0 && age <= 350 ? this.points : [];
  }
  close() { this.worker.terminate(); }
}
