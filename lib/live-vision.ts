import { VisionEngine, type VisionTimings } from "./vision-engine";
import type { VisionFrame } from "./vision-types";

export type LiveVisionTiming = VisionTimings & { capture: number; transport: number; age: number };
type Pending = {
  resolve: (frame: VisionFrame | null) => void; reject: (error: Error) => void;
  hands: (frame: VisionFrame) => void; started: number; capture: number; posted: number;
};

/** Capture only when the lane is free. Busy calls drop their source, not queue
 * a bitmap: the next animation tick snapshots the CURRENT video frame. */
export class LiveVision {
  private worker: Worker | null = null;
  private fallback: VisionEngine | null = null;
  private pending: Pending | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private closed = false;
  private occupied = false;
  private captureCanvas: OffscreenCanvas | null = null;
  private recovering: Promise<void> | null = null;
  private accelerated = true;
  private trackingProfile: "words" | "fingerspelling" = "words";
  get profile() { return this.trackingProfile; }
  private cancelStartup: ((error: Error) => void) | null = null;
  assetSource: VisionEngine["assetSource"] = "self-hosted";
  delegate: "GPU" | "CPU" = "CPU";
  mode: "worker" | "main" = "worker";
  readonly stats = { dropped: 0, recoveries: 0 };
  lastError: string | null = null;
  /** Called once per worker failure, before recovery starts. Hands already
   * painted by that worker are no longer current, and a failure during
   * capture resolves its frame as null, so callers cannot infer it. */
  onInterrupt: (() => void) | null = null;
  readonly timings: LiveVisionTiming = { capture: 0, hands: 0, auxiliary: 0, transport: 0, age: 0 };
  get busy() { return this.occupied || !!this.recovering; }

  static async create(progress?: (message: string) => void, accelerated = true, signal?: AbortSignal, profile: "words" | "fingerspelling" = "words") {
    signal?.throwIfAborted();
    const live = new LiveVision();
    const abort = () => live.close();
    signal?.addEventListener("abort", abort, { once: true });
    live.trackingProfile = profile;
    live.accelerated = profile === "words" && accelerated;
    try {
      if (typeof Worker === "undefined" || typeof createImageBitmap === "undefined"
        || typeof OffscreenCanvas === "undefined") throw new Error("Worker tracking unavailable");
      try { await live.launch(progress); }
      catch (error) {
        if (live.closed) throw error;
        live.lastError = String(error);
        live.worker?.terminate(); live.worker = null;
        live.accelerated = false;
        await live.launch(progress);
      }
    } catch (error) {
      if (live.closed) throw error;
      live.lastError = String(error);
      live.worker?.terminate(); live.worker = null;
      await live.loadFallback(progress);
    } finally {
      signal?.removeEventListener("abort", abort);
    }
    signal?.throwIfAborted();
    return live;
  }

  private async loadFallback(progress?: (message: string) => void) {
    if (this.trackingProfile === "fingerspelling") throw new Error("Fingerspelling hand tracking requires a working tracking worker");
    // A stuck GPU call cannot be terminated on the compatibility/UI thread.
    const engine = await VisionEngine.create(progress, false);
    if (this.closed) { engine.close(); return; }
    this.fallback = engine; this.mode = "main";
    this.assetSource = engine.assetSource; this.delegate = engine.delegate;
  }

  private launch(progress?: (message: string) => void) {
    return new Promise<void>((resolve, reject) => {
      if (this.closed) { reject(new Error("Tracking closed")); return; }
      this.cancelStartup = reject;
      // Classic bundle is intentional: MediaPipe's WASM loader uses importScripts.
      const worker = new Worker(this.trackingProfile === "fingerspelling" ? "/workers/fingerspelling-vision.worker.js" : "/workers/vision.worker.js");
      this.worker = worker;
      let ready = false;
      const fail = (message: string) => {
        if (this.closed || this.worker !== worker) return;
        clearTimeout(this.timer);
        if (!ready) { this.cancelStartup = null; reject(new Error(message)); return; }
        this.fail(new Error(message));
      };
      this.timer = setTimeout(() => fail("Tracking startup timed out"), 60000);
      worker.onerror = worker.onmessageerror = () => fail("Tracking worker interrupted");
      worker.onmessage = ({ data }) => {
        if (this.closed || this.worker !== worker) return;
        if (data.type === "progress") { progress?.(data.message); return; }
        if (data.type === "warming") {
          clearTimeout(this.timer);
          this.timer = setTimeout(() => fail("Tracking warmup timed out"), 4000);
          return;
        }
        if (data.type === "ready") {
          clearTimeout(this.timer); ready = true; this.cancelStartup = null;
          this.assetSource = data.assetSource; this.delegate = data.delegate; resolve(); return;
        }
        if (data.type === "error") { fail(data.message); return; }
        const pending = this.pending;
        if (!pending) return;
        if (data.type === "hands") {
          this.timings.hands = data.handsMs;
          this.timings.age = performance.now() - pending.started;
          pending.hands(data.frame);
        } else if (data.type === "result") {
          clearTimeout(this.timer);
          Object.assign(this.timings, data.timings, { capture: pending.capture,
            transport: Math.max(0, performance.now() - pending.posted - data.timings.hands - data.timings.auxiliary) });
          this.pending = null; pending.resolve(data.frame);
        }
      };
      worker.postMessage({ type: "init", accelerated: this.accelerated });
    });
  }

  private fail(error: Error) {
    this.lastError = error.message;
    this.worker?.terminate(); this.worker = null;
    this.stats.recoveries++;
    // A failed GPU context must not be selected again during recovery.
    this.accelerated = false;
    const pending = this.pending; this.pending = null;
    // Recover off-thread with CPU first; a missing/broken worker platform can
    // still use the main-thread engine. Never reuse a failed GPU context.
    this.recovering = this.launch().catch(async () => {
      this.worker?.terminate(); this.worker = null;
      if (!this.closed) await this.loadFallback();
    }).finally(() => { this.recovering = null; });
    // Surface failures through process; consume a background rejection as well.
    void this.recovering.catch(() => {});
    if (!this.closed) this.onInterrupt?.();
    pending?.reject(error);
  }

  async process(video: HTMLVideoElement | HTMLCanvasElement, timestamp: number,
    onHands: (frame: VisionFrame) => void): Promise<VisionFrame | null> {
    if (this.closed) return null;
    if (this.busy) { this.stats.dropped++; return null; }
    this.occupied = true;
    const started = performance.now();
    try {
      if (this.fallback) {
        // A synchronous callback cannot paint until this thread yields. Report
        // the full wait on the compatibility path rather than hiding aux cost.
        const frame = this.fallback.process(video, timestamp);
        this.timings.age = performance.now() - started;
        onHands(frame);
        Object.assign(this.timings, this.fallback.timings, { capture: 0, transport: 0 });
        return frame;
      }
      if (!this.worker) throw new Error("Tracking unavailable. Restart the camera.");
      const captureWorker = this.worker;
      let bitmap: ImageBitmap;
      if (this.trackingProfile === "fingerspelling") {
        const sourceWidth = "videoWidth" in video ? video.videoWidth : video.width;
        const sourceHeight = "videoHeight" in video ? video.videoHeight : video.height;
        const factor = Math.min(1, 640 / Math.max(sourceWidth, sourceHeight));
        const width = Math.round(sourceWidth * factor), height = Math.round(sourceHeight * factor);
        if (!this.captureCanvas || this.captureCanvas.width !== width || this.captureCanvas.height !== height) {
          this.captureCanvas = new OffscreenCanvas(width, height);
        }
        const context = this.captureCanvas.getContext("2d", { willReadFrequently: true });
        if (!context) throw new Error("Camera RGB capture unavailable");
        // Snapshot decoded pixels, avoiding video-backed texture orientation/format.
        // The word-recognition producer retains its existing direct bitmap path.
        context.drawImage(video, 0, 0, width, height);
        bitmap = await createImageBitmap(context.getImageData(0, 0, width, height));
      } else bitmap = await createImageBitmap(video);
      if (this.closed || this.worker !== captureWorker || this.recovering) { bitmap.close(); return null; }
      const posted = performance.now();
      return await new Promise<VisionFrame | null>((resolve, reject) => {
        this.pending = { resolve, reject, hands: onHands, started, capture: posted - started, posted };
        this.timer = setTimeout(() => this.fail(new Error("Tracking frame timed out")), 8000);
        try { this.worker!.postMessage({ type: "frame", bitmap, timestamp }, [bitmap]); }
        catch (error) { bitmap.close(); clearTimeout(this.timer); this.fail(error as Error); }
      });
    } finally { this.occupied = false; }
  }

  close() {
    this.captureCanvas = null;
    this.closed = true; clearTimeout(this.timer);
    this.cancelStartup?.(new Error("Tracking closed")); this.cancelStartup = null;
    this.worker?.terminate(); this.worker = null;
    this.fallback?.close(); this.fallback = null;
    this.pending?.resolve(null); this.pending = null;
  }
}
