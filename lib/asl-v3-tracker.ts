import { analysisSize, CAMERA_MAX_LONG_SIDE, FPS } from "../engine-v3/web/preprocess.mjs";
import type { VisionFrame } from "./vision-types";

export type AslV3TrackerInput =
  | { type: "init"; delegate?: "CPU" | "GPU" }
  | { type: "reset" }
  | { type: "frame"; id: number; image: ImageBitmap; width: number; height: number; timestamp: number };

export type AslV3TrackerOutput =
  | { type: "ready"; delegate: "CPU" | "GPU" }
  | { type: "frame"; id: number; frame: VisionFrame; trackingMs: number }
  | { type: "error"; id?: number; message: string };

type TrackerOptions = {
  onFrame: (frame: VisionFrame, trackingMs: number) => void;
  onError: (error: Error, fatal: boolean) => void;
  signal?: AbortSignal;
};

type FrameJob = { id: number; generation: number; timeout: ReturnType<typeof setTimeout> };
const FRAME_INTERVAL_MS = 1000 / FPS - 4; // V3.1 allows for display callback jitter.
const FRAME_TIMEOUT_MS = 8000;
let preferredDelegate: "CPU" | "GPU" | undefined;

/** Uses the workspace's existing video element. Only one bitmap capture or
 * tracking request is outstanding. When another frame arrives while busy,
 * capture the newest displayed pixels as soon as tracking becomes free. */
export class AslV3Tracker {
  readonly assetSource = "self-hosted" as const;
  private busy: FrameJob | null = null;
  private latest: HTMLVideoElement | null = null;
  private closed = false;
  private generation = 0;
  private nextId = 0;
  private lastSentAt = -Infinity;
  private lastVideoTime = -Infinity;

  private constructor(private readonly worker: Worker, private readonly options: TrackerOptions) {
    worker.onmessage = (event: MessageEvent<AslV3TrackerOutput>) => this.receive(event.data);
    worker.onerror = event => {
      event.preventDefault();
      this.fail(new Error("ASL tracking worker was interrupted"), true);
    };
    worker.onmessageerror = () => this.fail(new Error("ASL tracking worker sent an unreadable frame"), true);
  }

  static async create(options: TrackerOptions) {
    options.signal?.throwIfAborted();
    if (typeof createImageBitmap !== "function") throw new Error("This browser cannot capture frames for ASL tracking");
    const worker = new Worker("/workers/asl-v3-tracker.worker.js");
    try {
      const delegate = await new Promise<"CPU" | "GPU">((resolve, reject) => {
        const finish = () => {
          clearTimeout(timeout);
          options.signal?.removeEventListener("abort", abort);
          worker.onmessage = worker.onerror = worker.onmessageerror = null;
        };
        const fail = (error: Error) => { finish(); reject(error); };
        const abort = () => fail(new DOMException("ASL tracking startup was cancelled", "AbortError"));
        const timeout = setTimeout(() => fail(new Error("ASL tracking models did not start in time")), 60000);
        options.signal?.addEventListener("abort", abort, { once: true });
        worker.onmessage = ({ data }: MessageEvent<AslV3TrackerOutput>) => {
          if (data.type === "ready") { finish(); resolve(data.delegate); }
          else if (data.type === "error") fail(new Error(data.message));
        };
        worker.onerror = event => {
          event.preventDefault();
          fail(new Error("ASL tracking worker could not start"));
        };
        worker.onmessageerror = () => fail(new Error("ASL tracking worker sent an unreadable startup reply"));
        try { worker.postMessage({ type: "init", delegate: preferredDelegate } satisfies AslV3TrackerInput); }
        catch (error) { fail(asError(error)); }
      });
      options.signal?.throwIfAborted();
      preferredDelegate = delegate;
      return new AslV3Tracker(worker, options);
    } catch (error) {
      worker.terminate();
      throw error;
    }
  }

  schedule(video: HTMLVideoElement, timestamp: number) {
    if (this.closed || !Number.isFinite(timestamp) || video.readyState < 2 || !video.videoWidth || !video.videoHeight
      || !Number.isFinite(video.currentTime) || video.currentTime === this.lastVideoTime) return;
    if (this.busy) {
      this.latest = video;
      return;
    }
    if (timestamp - this.lastSentAt < FRAME_INTERVAL_MS) return;
    this.lastSentAt = timestamp;
    this.lastVideoTime = video.currentTime;
    const [width, height] = analysisSize(video.videoWidth, video.videoHeight,
      Math.min(CAMERA_MAX_LONG_SIDE, Math.max(video.videoWidth, video.videoHeight)));
    const id = ++this.nextId;
    const job: FrameJob = {
      id,
      generation: this.generation,
      timeout: setTimeout(() => this.fail(new Error("ASL tracking stopped responding"), true), FRAME_TIMEOUT_MS),
    };
    this.busy = job;
    void this.capture(video, timestamp, width, height, job);
  }

  reset() {
    if (this.closed) return;
    this.generation++;
    this.latest = null;
    this.lastSentAt = this.lastVideoTime = -Infinity;
    try { this.worker.postMessage({ type: "reset" } satisfies AslV3TrackerInput); }
    catch (error) { this.fail(asError(error), true); }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    if (this.busy) clearTimeout(this.busy.timeout);
    this.busy = null;
    this.latest = null;
    this.worker.onmessage = this.worker.onerror = this.worker.onmessageerror = null;
    this.worker.terminate();
  }

  private async capture(video: HTMLVideoElement, timestamp: number, width: number, height: number, job: FrameJob) {
    let image: ImageBitmap | undefined;
    try {
      image = await createImageBitmap(video, { resizeWidth: width, resizeHeight: height, resizeQuality: "high" });
      if (this.closed || this.generation !== job.generation) {
        image.close();
        this.finish(job);
        return;
      }
      this.worker.postMessage({ type: "frame", id: job.id, image, width, height, timestamp } satisfies AslV3TrackerInput, [image]);
    } catch (error) {
      image?.close();
      if (!this.closed && this.generation === job.generation) this.fail(asError(error), false);
      this.finish(job);
    }
  }

  private receive(message: AslV3TrackerOutput) {
    if (message.type === "ready") return;
    if (message.type === "error" && message.id === undefined) {
      this.fail(new Error(message.message), true);
      return;
    }
    const job = this.busy;
    if (!job || message.id !== job.id) return;
    try {
      if (job.generation !== this.generation) return;
      if (message.type === "error") this.fail(new Error(message.message), false);
      else this.options.onFrame(message.frame, message.trackingMs);
    } catch (error) {
      this.fail(asError(error), false);
    } finally {
      this.finish(job);
    }
  }

  private finish(job: FrameJob) {
    if (this.busy !== job) return;
    clearTimeout(job.timeout);
    this.busy = null;
    const latest = this.latest;
    this.latest = null;
    if (latest) this.schedule(latest, performance.now());
  }

  private fail(error: Error, fatal: boolean) {
    if (this.closed) return;
    if (fatal) this.close();
    this.options.onError(error, fatal);
  }
}

function asError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error));
}
