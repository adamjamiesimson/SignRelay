import type { VisionFrame, WorkerInput, WorkerMessage } from "./vision-types";
import { packTemplates } from "./template-transport";

type Port = Pick<Worker, "postMessage" | "terminate" | "onmessage" | "onerror" | "onmessageerror">;
type Configuration = Extract<WorkerInput, { type: "templates" }>;
type Control = Configuration | Extract<WorkerInput, { type: "reset" }>;
export type SessionStatus = { state: "running" | "recovering" | "failed"; message: string };

const validConfidence = (value: number) => Number.isFinite(value) && value >= 0 && value <= 1;
const optionalText = (value: unknown) => value === undefined || typeof value === "string";

/** One in-flight frame and one replaceable latest frame. No unbounded camera
 * backlog, and no output from a worker/session that has already been replaced.
 */
export class RecognitionSession {
  private worker: Port | null = null;
  private configuration: Configuration = { type: "templates", language: "asl", templates: [] };
  private session = 0;
  private nextFrameId = 0;
  private waiting: { id: number; session: number; since: number } | null = null;
  private queued: VisionFrame | null = null;
  private deferredControl: Control | null = null;
  private restarts: number[] = [];
  private recovering = false;
  private closed = false;
  /** Milliseconds from posting the last answered frame to its analysis. */
  lastRoundTripMs: number | null = null;
  /** Counters for the opt-in ?perf readout (numbers only). `replaced` frames
   * were superseded by a newer camera frame before they could be forwarded;
   * `lastQueueAgeMs` is how long the last forwarded frame waited. */
  readonly stats = { offered: 0, forwarded: 0, replaced: 0, answered: 0, lastQueueAgeMs: null as number | null, recoveries: 0 };
  /** Last state reported through onStatus, for the ?perf readout. */
  state: SessionStatus["state"] = "running";
  private queuedAt = 0;
  private watchdog: ReturnType<typeof setInterval>;

  constructor(
    private createWorker: () => Port,
    private onMessage: (message: WorkerMessage) => void,
    private readonly reportStatus: (status: SessionStatus) => void,
    private readonly measure = false,
  ) {
    this.launch();
    this.watchdog = setInterval(() => {
      if (this.waiting && (this.waiting.session === this.session || this.queued)
        && performance.now() - this.waiting.since >= 8000) {
        this.recover("Recognition stopped responding. Restarting…");
      }
    }, 1000);
  }

  postMessage(message: WorkerInput) {
    if (this.closed) return;
    if (message.type === "frame") {
      if (!this.worker) return;
      this.stats.offered++;
      if (this.queued) this.stats.replaced++;
      this.queued = message.frame;
      this.queuedAt = performance.now();
      this.pump();
      return;
    }
    if (message.type === "templates") this.configuration = message;
    this.session++;
    // A reset invalidates the result, but the worker still owns that frame.
    // Keep its acknowledgement slot so repeated resets cannot queue frames.
    this.queued = null;
    if (!this.worker) {
      if (message.type === "reset") return;
      this.restarts = [];
      this.recovering = true;
      this.onStatus({ state: "recovering", message: "Restarting recognition…" });
      this.launch();
      return;
    }
    if (this.waiting) {
      // Configuring templates also resets recognition. A subsequent reset
      // cannot replace a configuration that the worker has yet to receive.
      if (message.type === "templates" || !this.deferredControl) this.deferredControl = message;
      return;
    }
    try {
      this.send(this.worker, message);
    } catch {
      this.recover("Recognition could not receive the session. Restarting…");
    }
  }

  resetStats() {
    Object.assign(this.stats, { offered: 0, forwarded: 0, replaced: 0, answered: 0, lastQueueAgeMs: null, recoveries: 0 });
  }

  private onStatus(status: SessionStatus) {
    this.state = status.state;
    this.reportStatus(status);
  }

  restart() {
    if (this.closed) return;
    this.restarts = [];
    this.recover("Restarting recognition…");
  }

  terminate() {
    this.closed = true;
    clearInterval(this.watchdog);
    this.waiting = null;
    this.queued = null;
    this.disposeWorker();
  }

  private launch() {
    if (this.closed) return;
    try {
      const worker = this.createWorker();
      this.worker = worker;
      worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
        if (worker !== this.worker || !event.data || typeof event.data !== "object") return;
        const message = event.data;
        const waiting = this.waiting;
        if (message.type === "analysis" && waiting && message.frameId === waiting.id && message.session === waiting.session) {
          this.waiting = null;
          if (message.session !== this.session) {
            const control = this.deferredControl;
            this.deferredControl = null;
            try { if (control) this.send(worker, control); }
            catch { this.recover("Recognition could not receive the session. Restarting…"); return; }
            this.pump();
            return;
          }
          if ((message.state !== "listening" && message.state !== "processing" && message.state !== "uncertain")
            || (message.candidate !== null && typeof message.candidate !== "string")
            || !validConfidence(message.confidence)
            || !Number.isSafeInteger(message.bufferSize) || message.bufferSize < 0 || message.bufferSize > 300
            || !optionalText(message.feedback) || !optionalText(message.motionReason)) {
            this.recover("Recognition returned an invalid analysis. Restarting…");
            return;
          }
          this.lastRoundTripMs = performance.now() - waiting.since;
          this.stats.answered++;
          if (this.recovering) {
            this.recovering = false;
            this.onStatus({ state: "running", message: "" });
          }
          this.onMessage(message);
          this.pump();
        } else if (message.session === this.session) {
          if (message.type === "fault") {
            this.recover(typeof message.message === "string" ? message.message : "Recognition was interrupted. Restarting…");
            return;
          }
          if ((message.type === "confirmed" || message.type === "suggested")
            && Number.isFinite(message.timestamp) && message.timestamp >= 0
            && validConfidence(message.confidence)
            && typeof message.text === "string" && message.text.trim()
            && typeof message.gloss === "string" && message.gloss.trim()) this.onMessage(message);
        }
      };
      worker.onerror = worker.onmessageerror = () => {
        if (worker === this.worker) this.recover("Recognition was interrupted. Restarting…");
      };
      this.send(worker, this.configuration);
    } catch {
      this.recover("Recognition could not start. Retrying…");
    }
  }

  /** Templates go as one transferred buffer, so neither the page nor the
   * recognition thread spends hundreds of milliseconds cloning them. */
  private send(worker: Port, message: WorkerInput) {
    if (message.type !== "templates" || !Array.isArray(message.templates)) {
      worker.postMessage({ ...message, session: this.session });
      return;
    }
    const templates = packTemplates(message.templates);
    worker.postMessage({ ...message, templates, session: this.session }, [templates.values.buffer]);
  }

  private pump() {
    if (!this.worker || this.waiting || !this.queued) return;
    const frame = this.queued;
    this.queued = null;
    this.waiting = { id: ++this.nextFrameId, session: this.session, since: performance.now() };
    this.stats.forwarded++;
    this.stats.lastQueueAgeMs = this.waiting.since - this.queuedAt;
    try {
      this.worker.postMessage({ type: "frame", frame, frameId: this.waiting.id, session: this.session,
        ...(this.measure ? { measure: true } : {}) } satisfies WorkerInput);
    } catch {
      this.recover("Recognition could not receive a frame. Restarting…");
    }
  }

  private recover(message: string) {
    this.stats.recoveries++;
    this.disposeWorker();
    this.waiting = null;
    this.queued = null;
    this.session++;
    const now = performance.now();
    this.restarts = this.restarts.filter(time => now - time < 60000);
    if (this.restarts.length >= 2) {
      this.onStatus({ state: "failed", message: "Recognition is paused after repeated interruptions. Use Restart recognition to try again." });
      return;
    }
    this.restarts.push(now);
    this.recovering = true;
    this.onStatus({ state: "recovering", message });
    this.launch();
  }

  private disposeWorker() {
    this.deferredControl = null;
    if (!this.worker) return;
    this.worker.onmessage = this.worker.onerror = this.worker.onmessageerror = null;
    this.worker.terminate();
    this.worker = null;
  }
}
