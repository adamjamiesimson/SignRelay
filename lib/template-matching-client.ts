import type { CalibrationTemplate, VisionFrame } from "./vision-types";

export type TemplatePrediction = { label: string; text: string; confidence: number; margin?: number };
export type MatchRequest = { type: "match"; id: number; generation: number; frames: VisionFrame[] };
export type MatchInput = MatchRequest | { type: "configure"; kind: "personal" | "psl"; templates: CalibrationTemplate[] }
  | { type: "cancel" };
export type MatchOutput = { id: number; generation: number; prediction: TemplatePrediction | null; error?: string };
type Port = Pick<Worker, "postMessage" | "terminate" | "onmessage" | "onerror" | "onmessageerror">;

/** A separate CPU lane: one active scan plus one replaceable latest snapshot.
 * Never await matching on the recognition worker's frame/acknowledgement path.
 * Cancellation is cooperative; the watchdog terminates only a stuck matcher.
 */
export class TemplateMatchingClient {
  private worker: Port | null = null;
  private templates: CalibrationTemplate[] = [];
  private active: MatchRequest | null = null;
  private queued: MatchRequest | null = null;
  private generation = 0;
  private nextId = 0;
  private newestTimestamp = -Infinity;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private retryAfter = 0;
  private failures = 0;
  private closed = false;

  constructor(private kind: "personal" | "psl",
    private onResult: (prediction: TemplatePrediction | null, timestamp: number) => void,
    private onError: (message: string) => void = () => {},
    private createWorker: () => Port = () => new Worker("/workers/template-matching.worker.js", { type: "module" }),
  ) {}

  configure(templates: CalibrationTemplate[] = []) {
    this.reset();
    this.templates = templates;
    this.worker?.postMessage({ type: "configure", kind: this.kind, templates } satisfies MatchInput);
  }

  submit(frames: VisionFrame[]) {
    if (this.closed || !frames.length || (this.kind === "personal" && !this.templates.length)) return;
    this.newestTimestamp = frames.at(-1)!.timestamp;
    this.queued = { type: "match", id: ++this.nextId, generation: this.generation, frames: [...frames] };
    this.pump();
  }

  reset() {
    this.generation++;
    this.queued = null;
    this.newestTimestamp = -Infinity;
    // Keep the in-flight slot until it acknowledges cancellation. Otherwise
    // a reset could post a second scan while the first is still unwinding.
    this.worker?.postMessage({ type: "cancel" } satisfies MatchInput);
  }

  terminate() { this.closed = true; this.queued = null; this.dispose(); }

  private pump() {
    if (this.closed || this.active || !this.queued || performance.now() < this.retryAfter) return;
    try {
      if (!this.worker) {
        const worker = this.createWorker();
        this.worker = worker;
        worker.onmessage = ({ data }: MessageEvent<MatchOutput>) => {
          if (worker !== this.worker || data.id !== this.active?.id) return;
          const request = this.active;
          this.clearTimer();
          this.active = null;
          if (data.generation === this.generation && request.generation === this.generation) {
            if (data.error) { this.fail(data.error); return; }
            const timestamp = request.frames.at(-1)!.timestamp;
            if (this.newestTimestamp - timestamp <= 2500) this.onResult(data.prediction, timestamp);
            this.failures = 0;
          }
          this.pump();
        };
        worker.onerror = worker.onmessageerror = () => {
          if (worker === this.worker) this.fail("Template matching was interrupted. Retrying shortly…");
        };
        worker.postMessage({ type: "configure", kind: this.kind, templates: this.templates } satisfies MatchInput);
      }
      this.active = this.queued;
      this.queued = null;
      this.worker.postMessage(this.active);
      // Includes first PSL download; never restarts the camera/model worker.
      this.timer = setTimeout(() => this.fail("Template matching timed out. Retrying shortly…"), 120000);
    } catch { this.fail("Template matching could not start. Retrying shortly…"); }
  }

  private fail(message: string) {
    this.dispose();
    this.retryAfter = performance.now() + Math.min(60000, 5000 * 2 ** Math.min(this.failures++, 4));
    this.onError(message);
  }
  private clearTimer() { if (this.timer) clearTimeout(this.timer); this.timer = null; }
  private dispose() {
    this.clearTimer();
    if (this.worker) {
      this.worker.onmessage = this.worker.onerror = this.worker.onmessageerror = null;
      this.worker.terminate();
    }
    this.worker = null;
    this.active = null;
  }
}
