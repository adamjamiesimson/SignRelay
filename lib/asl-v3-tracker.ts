import { analysisSize, CAMERA_MAX_LONG_SIDE, FPS } from "../engine-v3/web/preprocess.mjs";
import { MAX_TRACKING_GAP_MS } from "./frame-timing";
import type { VisionFrame } from "./vision-types";

/** V3.1 feature slots holding the 13 pose points (86-point layout, x/y/z each). */
export const POSE_SLOTS = [42 * 3, 55 * 3] as const;

export type AslV3TrackerInput =
  | { type: "init"; delegate?: "CPU" | "GPU"; role?: "pose" }
  | { type: "reset" }
  | { type: "frame"; id: number; image: ImageBitmap; width: number; height: number; timestamp: number; externalPose?: boolean };

/** Per-task worker time in ms for diagnostics (sprint replay captures); not used by the UI. */
export type AslV3TrackerTimings = { draw: number; hand: number; pose: number; face: number; hands: number };

export type AslV3TrackerOutput =
  | { type: "ready"; delegate: "CPU" | "GPU" }
  | { type: "frame"; id: number; frame: VisionFrame; trackingMs: number; timings?: AslV3TrackerTimings }
  | { type: "pose"; id: number; timestamp: number; points: VisionFrame["pose"]; slots: Float32Array }
  | { type: "error"; id?: number; message: string };

type TrackerOptions = {
  onFrame: (frame: VisionFrame, trackingMs: number) => void;
  onError: (error: Error, fatal: boolean) => void;
  signal?: AbortSignal;
};

type FrameJob = { id: number; generation: number; externalPose: boolean; timeout: ReturnType<typeof setTimeout> };
type PoseSample = { generation: number; timestamp: number; points: VisionFrame["pose"]; slots: Float32Array };
const FRAME_INTERVAL_MS = 1000 / FPS - 4; // V3.1 allows for display callback jitter.
const FRAME_TIMEOUT_MS = 8000;
// Hand tracking is V3.1's critical path. On CPU, running pose serially after it on alternate
// frames held analysis near 10 Hz while hands were visible; V3.1 lost correct signs at that
// cadence (sprint 2026-11-23). With enough cores a second worker tracks pose in parallel at
// the same every-second-frame cadence. Any pose-worker problem falls back to in-worker pose.
const POSE_WORKER_MIN_CORES = 4;
const POSE_STALL_MS = 2000;
const POSE_STARTUP_MS = 60000;
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
  private poseWorker: Worker | null = null;
  private poseReady = false;
  private poseBusySince: number | null = null;
  private poseStartup: ReturnType<typeof setTimeout> | undefined;
  private latestPose: PoseSample | null = null;
  private framesSent = 0;

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
      const tracker = new AslV3Tracker(worker, options);
      if ((navigator.hardwareConcurrency ?? 0) >= POSE_WORKER_MIN_CORES) tracker.startPoseWorker(delegate);
      return tracker;
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
    const pose = this.poseRouting(timestamp);
    this.framesSent++;
    const job: FrameJob = {
      id,
      generation: this.generation,
      externalPose: pose.external,
      timeout: setTimeout(() => this.fail(new Error("ASL tracking stopped responding"), true), FRAME_TIMEOUT_MS),
    };
    this.busy = job;
    void this.capture(video, timestamp, width, height, job, pose.send);
  }

  reset() {
    if (this.closed) return;
    this.generation++;
    this.latest = null;
    this.latestPose = null;
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
    this.stopPoseWorker();
    this.worker.onmessage = this.worker.onerror = this.worker.onmessageerror = null;
    this.worker.terminate();
  }

  /** Optional parallel pose tracking. Never fatal: on any failure the tracking worker resumes pose. */
  private startPoseWorker(delegate: "CPU" | "GPU") {
    let worker: Worker;
    try { worker = new Worker("/workers/asl-v3-tracker.worker.js"); } catch { return; }
    this.poseWorker = worker;
    const disable = () => { if (this.poseWorker === worker) this.stopPoseWorker(); };
    this.poseStartup = setTimeout(disable, POSE_STARTUP_MS);
    worker.onerror = event => { event.preventDefault(); disable(); };
    worker.onmessageerror = disable;
    worker.onmessage = ({ data }: MessageEvent<AslV3TrackerOutput>) => {
      if (this.poseWorker !== worker) return;
      if (data.type === "ready") {
        clearTimeout(this.poseStartup);
        this.poseReady = true;
      } else if (data.type === "pose") {
        this.poseBusySince = null;
        const generation = this.poseGenerations.get(data.id);
        this.poseGenerations.delete(data.id);
        if (generation === this.generation && (!this.latestPose || data.timestamp > this.latestPose.timestamp)) {
          this.latestPose = { generation, timestamp: data.timestamp, points: data.points, slots: data.slots };
        }
      } else if (data.type === "error") disable();
    };
    try { worker.postMessage({ type: "init", delegate, role: "pose" } satisfies AslV3TrackerInput); } catch { disable(); }
  }

  private poseGenerations = new Map<number, number>();

  private stopPoseWorker() {
    clearTimeout(this.poseStartup);
    const worker = this.poseWorker;
    this.poseWorker = null;
    this.poseReady = false;
    this.poseBusySince = null;
    this.latestPose = null;
    this.poseGenerations.clear();
    if (!worker) return;
    worker.onmessage = worker.onerror = worker.onmessageerror = null;
    worker.terminate();
  }

  /** Whether this frame's pose comes from the pose worker, and whether to send it there. */
  private poseRouting(timestamp: number) {
    if (!this.poseWorker || !this.poseReady) return { external: false, send: false };
    if (this.poseBusySince !== null) {
      if (performance.now() - this.poseBusySince > POSE_STALL_MS) {
        this.stopPoseWorker();
        return { external: false, send: false };
      }
      return { external: true, send: false };
    }
    const stale = !this.latestPose || timestamp - this.latestPose.timestamp > MAX_TRACKING_GAP_MS / 2;
    return { external: true, send: stale || this.framesSent % 2 === 0 };
  }

  private async capture(video: HTMLVideoElement, timestamp: number, width: number, height: number, job: FrameJob, sendPose: boolean) {
    let image: ImageBitmap | undefined;
    try {
      image = await createImageBitmap(video, { resizeWidth: width, resizeHeight: height, resizeQuality: "high" });
      if (this.closed || this.generation !== job.generation) {
        image.close();
        this.finish(job);
        return;
      }
      if (sendPose && this.poseWorker && this.poseReady && this.poseBusySince === null) this.sendPose(image, width, height, timestamp, job);
      this.worker.postMessage({ type: "frame", id: job.id, image, width, height, timestamp, externalPose: job.externalPose } satisfies AslV3TrackerInput, [image]);
    } catch (error) {
      image?.close();
      if (!this.closed && this.generation === job.generation) this.fail(asError(error), false);
      this.finish(job);
    }
  }

  private sendPose(image: ImageBitmap, width: number, height: number, timestamp: number, job: FrameJob) {
    const worker = this.poseWorker;
    if (!worker) return;
    this.poseBusySince = performance.now();
    this.poseGenerations.set(job.id, job.generation);
    // A copy keeps the original bitmap transferable to the hand-tracking worker.
    void createImageBitmap(image).then(copy => {
      if (this.poseWorker !== worker || this.closed) { copy.close(); return; }
      worker.postMessage({ type: "frame", id: job.id, image: copy, width, height, timestamp } satisfies AslV3TrackerInput, [copy]);
    }).catch(() => { if (this.poseWorker === worker) this.stopPoseWorker(); });
  }

  /** Merge the newest parallel pose (at most MAX_TRACKING_GAP_MS old) into a hand-tracked frame. */
  private mergePose(frame: VisionFrame) {
    const pose = this.latestPose;
    if (!pose || pose.generation !== this.generation || Math.abs(frame.timestamp - pose.timestamp) > MAX_TRACKING_GAP_MS) return;
    frame.pose = pose.points;
    frame.aslV3Features?.set(pose.slots, POSE_SLOTS[0]);
  }

  private receive(message: AslV3TrackerOutput) {
    if (message.type === "ready" || message.type === "pose") return;
    if (message.type === "error" && message.id === undefined) {
      this.fail(new Error(message.message), true);
      return;
    }
    const job = this.busy;
    if (!job || message.id !== job.id) return;
    try {
      if (job.generation !== this.generation) return;
      if (message.type === "error") this.fail(new Error(message.message), false);
      else {
        if (job.externalPose) this.mergePose(message.frame);
        this.options.onFrame(message.frame, message.trackingMs);
      }
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
