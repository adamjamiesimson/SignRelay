import type { CalibrationTemplate, VisionFrame } from "./vision-types";
import { packTemplates, type PackedTemplates } from "./template-transport";

export { packTemplates, unpackTemplates, type PackedTemplates } from "./template-transport";

export type TemplatePrediction = { label: string; text: string; confidence: number; margin?: number };
export type MatchRequest = { type: "match"; id: number; generation: number; frames: VisionFrame[] };
export type MatchInput = MatchRequest | { type: "configure"; kind: "personal" | "psl"; templates: PackedTemplates }
  | { type: "cancel" };
export type MatchOutput = { id: number; generation: number; prediction: TemplatePrediction | null; error?: string; phase?: "loading" | "matching" };
type Port = Pick<Worker, "postMessage" | "terminate" | "onmessage" | "onerror" | "onmessageerror">;
type ScheduledMatch = { request: MatchRequest; submittedAt: number };
const MAX_RESULT_AGE_MS = 2500;

/** A separate CPU lane: one active scan plus one replaceable latest snapshot.
 * Never await matching on the recognition worker's frame/acknowledgement path.
 * Cancellation is cooperative; the watchdog terminates only a stuck matcher.
 */
export class TemplateMatchingClient {
  private worker: Port | null = null;
  private templates: CalibrationTemplate[] = [];
  private active: ScheduledMatch | null = null;
  private queued: ScheduledMatch | null = null;
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
    try {
      if (this.worker) this.postTemplates(this.worker);
      // Start the personal matcher now, not on the first hand frame, so its
      // set-up never delays a frame the signer is waiting on. PSL stays lazy:
      // its references download only when PSL is actually used.
      else if (this.kind === "personal" && templates.length && !this.closed
        && performance.now() >= this.retryAfter) this.ensureWorker();
    } catch { this.fail("Saved signs could not be sent to the matcher. Retrying shortly…"); }
  }

  submit(frames: VisionFrame[]) {
    if (this.closed || !frames.length || (this.kind === "personal" && !this.templates.length)) return;
    this.newestTimestamp = frames.at(-1)!.timestamp;
    this.queued = { request: { type: "match", id: ++this.nextId, generation: this.generation, frames: [...frames] },
      submittedAt: performance.now() };
    this.pump();
  }

  reset() {
    this.generation++;
    this.queued = null;
    this.newestTimestamp = -Infinity;
    // Keep the in-flight slot until it acknowledges cancellation. Otherwise
    // a reset could post a second scan while the first is still unwinding.
    try { this.worker?.postMessage({ type: "cancel" } satisfies MatchInput); }
    catch { this.fail("Template matching was interrupted. Retrying shortly…"); }
  }

  terminate() { this.closed = true; this.queued = null; this.dispose(); }

  private pump() {
    if (this.closed || this.active || !this.queued || performance.now() < this.retryAfter) return;
    if (performance.now() - this.queued.submittedAt > MAX_RESULT_AGE_MS) { this.queued = null; return; }
    try {
      const worker = this.ensureWorker();
      this.active = this.queued;
      this.queued = null;
      worker.postMessage(this.active.request);
      // Includes first PSL download; never restarts the camera/model worker.
      this.armTimeout(120000);
    } catch { this.fail("Template matching could not start. Retrying shortly…"); }
  }

  private postTemplates(worker: Port) {
    const templates = packTemplates(this.templates);
    worker.postMessage({ type: "configure", kind: this.kind, templates } satisfies MatchInput, [templates.values.buffer]);
  }

  private ensureWorker() {
    if (this.worker) return this.worker;
    const worker = this.createWorker();
    this.worker = worker;
    worker.onmessage = ({ data }: MessageEvent<MatchOutput>) => {
      if (worker !== this.worker || data.id !== this.active?.request.id) return;
      if (data.phase) {
        if (data.generation === this.generation) this.armTimeout(data.phase === "loading" ? 400000 : 20000);
        return;
      }
      const { request, submittedAt } = this.active;
      this.clearTimer();
      this.active = null;
      if (data.generation === this.generation && request.generation === this.generation) {
        if (data.error) { this.fail(data.error); return; }
        const timestamp = request.frames.at(-1)!.timestamp;
        if (this.newestTimestamp - timestamp <= MAX_RESULT_AGE_MS
          && performance.now() - submittedAt <= MAX_RESULT_AGE_MS) this.onResult(data.prediction, timestamp);
        this.failures = 0;
      }
      this.pump();
    };
    worker.onerror = worker.onmessageerror = () => {
      if (worker === this.worker) this.fail("Template matching was interrupted. Retrying shortly…");
    };
    this.postTemplates(worker);
    return worker;
  }

  private fail(message: string) {
    this.dispose();
    this.retryAfter = performance.now() + Math.min(60000, 5000 * 2 ** Math.min(this.failures++, 4));
    this.onError(message);
  }
  private clearTimer() { if (this.timer) clearTimeout(this.timer); this.timer = null; }
  private armTimeout(ms: number) {
    this.clearTimer();
    this.timer = setTimeout(() => this.fail("Template matching timed out. Retrying shortly…"), ms);
  }
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
