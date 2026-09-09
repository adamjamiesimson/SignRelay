import type { VisionFrame, WorkerInput, WorkerMessage } from "./vision-types";

type Port = Pick<Worker, "postMessage" | "terminate" | "onmessage" | "onerror" | "onmessageerror">;
type Configuration = Extract<WorkerInput, { type: "templates" }>;
export type SessionStatus = { state: "running" | "recovering" | "failed"; message: string };

/** One in-flight frame and one replaceable latest frame. No unbounded camera
 * backlog, and no output from a worker/session that has already been replaced.
 */
export class RecognitionSession {
  private worker: Port | null = null;
  private configuration: Configuration = { type: "templates", language: "asl", templates: [] };
  private session = 0;
  private nextFrameId = 0;
  private waiting: { id: number; since: number } | null = null;
  private queued: VisionFrame | null = null;
  private restarts: number[] = [];
  private recovering = false;
  private closed = false;
  private watchdog: ReturnType<typeof setInterval>;

  constructor(
    private createWorker: () => Port,
    private onMessage: (message: WorkerMessage) => void,
    private onStatus: (status: SessionStatus) => void,
  ) {
    this.launch();
    this.watchdog = setInterval(() => {
      if (this.waiting && Date.now() - this.waiting.since >= 8000) {
        this.recover("Recognition stopped responding. Restarting…");
      }
    }, 1000);
  }

  postMessage(message: WorkerInput) {
    if (this.closed) return;
    if (message.type === "frame") {
      if (!this.worker) return;
      this.queued = message.frame;
      this.pump();
      return;
    }
    if (message.type === "templates") this.configuration = message;
    this.session++;
    this.waiting = null;
    this.queued = null;
    if (!this.worker) {
      this.restarts = [];
      this.recovering = true;
      this.onStatus({ state: "recovering", message: "Restarting recognition…" });
      this.launch();
      return;
    }
    try {
      this.worker.postMessage({ ...message, session: this.session });
    } catch {
      this.recover("Recognition could not receive the session. Restarting…");
    }
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
        if (worker !== this.worker || event.data.session !== this.session) return;
        const message = event.data;
        if (message.type === "fault") { this.recover(message.message); return; }
        if (message.type === "analysis" && message.frameId === this.waiting?.id) {
          this.waiting = null;
          if (this.recovering) {
            this.recovering = false;
            this.onStatus({ state: "running", message: "" });
          }
          this.onMessage(message);
          this.pump();
        } else if (message.type === "confirmed") this.onMessage(message);
      };
      worker.onerror = worker.onmessageerror = () => {
        if (worker === this.worker) this.recover("Recognition was interrupted. Restarting…");
      };
      worker.postMessage({ ...this.configuration, session: this.session });
    } catch {
      this.recover("Recognition could not start. Retrying…");
    }
  }

  private pump() {
    if (!this.worker || this.waiting || !this.queued) return;
    const frame = this.queued;
    this.queued = null;
    this.waiting = { id: ++this.nextFrameId, since: Date.now() };
    try {
      this.worker.postMessage({ type: "frame", frame, frameId: this.waiting.id, session: this.session } satisfies WorkerInput);
    } catch {
      this.recover("Recognition could not receive a frame. Restarting…");
    }
  }

  private recover(message: string) {
    this.disposeWorker();
    this.waiting = null;
    this.queued = null;
    this.session++;
    this.restarts = this.restarts.filter(time => Date.now() - time < 60000);
    if (this.restarts.length >= 2) {
      this.onStatus({ state: "failed", message: "Recognition is paused after repeated interruptions. Use Restart recognition to try again." });
      return;
    }
    this.restarts.push(Date.now());
    this.recovering = true;
    this.onStatus({ state: "recovering", message });
    this.launch();
  }

  private disposeWorker() {
    if (!this.worker) return;
    this.worker.onmessage = this.worker.onerror = this.worker.onmessageerror = null;
    this.worker.terminate();
    this.worker = null;
  }
}
