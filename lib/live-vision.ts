import { VisionEngine, type VisionTimings } from "./vision-engine";
import { FingerspellingSamplingClock } from "./fingerspelling-sampling";
import { MediaTrackingClock, OwnFrameSource } from "./decoded-frame";
import type { VisionFrame } from "./vision-types";

export type CapturedVisionFrame = VisionFrame & { capturedAt:number; mediaSlot:number; presentedFrames:number };
export type LiveVisionTiming = VisionTimings & { capture: number; transport: number; age: number };
type Pending = {
  resolve: (frame: VisionFrame | null) => void; reject: (error: Error) => void;
  hands: (frame: VisionFrame) => void; started: number; capture: number; posted: number;
  metadata?:{mediaSlot:number;presentedFrames:number};
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
  private sourceVideo: HTMLVideoElement | null = null;
  private frameCallback: number | null = null;
  private decodedFrame: VideoFrameCallbackMetadata | null = null;
  private sampling = new FingerspellingSamplingClock();
  private snapshot: { bitmap:ImageBitmap; timestamp:number; capturedAt:number; mediaSlot:number; presentedFrames:number } | null = null;
  private snapshotCanvas:OffscreenCanvas | null = null;
  private snapshotError:Error | null = null;
  private draining = false;
  private idleWaiters:(()=>void)[]=[];
  private frameClockOffset: number | null = null;
  private lastCallbackMediaTime = -Infinity;
  private ownClockActive = false;
  private lastSampleTimestamp = -Infinity;
  private lastWordTimestamp = -Infinity;
  /** Pixels and capture time from one immutable frame when WebCodecs allows. */
  private ownFrames = new OwnFrameSource();
  private wordMediaClock = new MediaTrackingClock();
  /**
   * Word-mode timestamp policy. "capture-time" stamps each frame with its own
   * decoded-frame interval; "pickup-tick" (default, unchanged) stamps it with
   * the animation tick at which the tracking lane became free. Matched
   * synthetic evidence showed capture-time is not neutral for the starter
   * rules (fewer YES confirmations at >=80 ms tracking; identical negative
   * controls), so it stays opt-in until real-signer evidence exists.
   * See docs/engineering-sprint-2026-11-03.
   */
  wordClockPolicy: "pickup-tick" | "capture-time" = "pickup-tick";
  get frameAvailable() {
    return this.trackingProfile==="words" || (!this.draining && (!!this.snapshot || !!this.snapshotError || !this.sourceVideo));
  }
  private watchDecodedFrames(video:HTMLVideoElement) {
    if(this.sourceVideo===video)return;
    if(typeof video.requestVideoFrameCallback!=="function")throw new Error("Fingerspelling requires decoded video timestamps");
    if(this.sourceVideo&&this.frameCallback!==null)this.sourceVideo.cancelVideoFrameCallback(this.frameCallback);
    this.snapshot?.bitmap.close();this.snapshot=null;this.sourceVideo=video;
    this.sampling=new FingerspellingSamplingClock();this.frameClockOffset=null;this.snapshotError=null;
    this.ownFrames=new OwnFrameSource();this.lastCallbackMediaTime=-Infinity;
    const observe:VideoFrameRequestCallback=(_now,metadata)=>{
      if(this.closed||this.sourceVideo!==video)return;
      if(!this.draining&&Number.isFinite(metadata.mediaTime)&&metadata.mediaTime>=0){
        this.decodedFrame=metadata;
        this.sampleDecodedFrame(video,metadata);
      }
      this.frameCallback=video.requestVideoFrameCallback(observe);
    };
    this.frameCallback=video.requestVideoFrameCallback(observe);
  }
  private sampleDecodedFrame(video:HTMLVideoElement,metadata:VideoFrameCallbackMetadata) {
    // The element can already show a newer frame than this metadata describes;
    // take the timestamp from the pixels' own frame when WebCodecs allows.
    const advanced=metadata.mediaTime>this.lastCallbackMediaTime;this.lastCallbackMediaTime=metadata.mediaTime;
    const own=this.ownFrames.take(video,advanced);
    // Falling back mid-stream may change media-clock domain (other engines):
    // restart the lattice and offset rather than stall on earlier slots.
    if(this.ownClockActive&&!own){this.sampling=new FingerspellingSamplingClock();this.frameClockOffset=null;}
    this.ownClockActive=!!own;
    try {
      const mediaSeconds=own?own.mediaMs/1000:metadata.mediaTime;
      this.frameClockOffset??=metadata.expectedDisplayTime-mediaSeconds*1000;
      const timestamp=mediaSeconds*1000+this.frameClockOffset;
      // The tracker rejects non-increasing times as a fault; never send one.
      if(own?.repeat||timestamp<=this.lastSampleTimestamp)return;
      const slot=this.sampling.take(mediaSeconds);
      if(slot===null)return;
      const ratio=Math.min(1,640/video.videoWidth,640/video.videoHeight);
      const w=Math.max(1,Math.round(video.videoWidth*ratio)),h=Math.max(1,Math.round(video.videoHeight*ratio));
      this.snapshotCanvas??=new OffscreenCanvas(w,h);
      if(this.snapshotCanvas.width!==w||this.snapshotCanvas.height!==h){this.snapshotCanvas.width=w;this.snapshotCanvas.height=h;}
      const ctx=this.snapshotCanvas.getContext("2d");
      if(!ctx)throw new Error("Decoded-frame snapshot unavailable");
      const capturedAt=performance.now();
      ctx.drawImage(own?.frame??video,0,0,w,h);
      // Synchronous snapshot in the callback associates pixels with THIS
      // decoded timestamp; createImageBitmap(video) after await does not.
      const bitmap=this.snapshotCanvas.transferToImageBitmap();
      if(this.snapshot){this.snapshot.bitmap.close();this.stats.replaced++;}
      this.snapshot={bitmap,timestamp,capturedAt,mediaSlot:slot,presentedFrames:metadata.presentedFrames};
      this.lastSampleTimestamp=timestamp;
      this.stats.sampled++;
    } catch (error) {
      this.snapshot?.bitmap.close();
      this.snapshot = null;
      this.snapshotError = error instanceof Error ? error : new Error(String(error));
    }
    finally {own?.frame.close();}
  }
  private whenIdle() {return this.occupied?new Promise<void>(resolve=>this.idleWaiters.push(resolve)):Promise.resolve();}
  /** Stop sampling, complete the in-flight frame and the single bounded snapshot.
   * The caller seals its capture at cutoff BEFORE awaiting; later pixels are excluded. */
  async drain(video:HTMLVideoElement,cutoff:number,onHands:(frame:VisionFrame)=>void) {
    if(this.trackingProfile!=="fingerspelling")return;
    this.draining=true;
    try {
      await this.whenIdle();
      if(this.snapshot&&this.snapshot.capturedAt<=cutoff&&!this.closed)await this.process(video,performance.now(),onHands);
    } finally {this.draining=false;}
  }
  private recovering: Promise<void> | null = null;
  private accelerated = true;
  private trackingProfile: "words" | "fingerspelling" = "words";
  get profile() { return this.trackingProfile; }
  private cancelStartup: ((error: Error) => void) | null = null;
  assetSource: VisionEngine["assetSource"] = "self-hosted";
  delegate: "GPU" | "CPU" = "CPU";
  mode: "worker" | "main" = "worker";
  readonly stats = { dropped: 0, recoveries: 0, sampled:0, replaced:0, stale:0, repeated:0 };
  /** Whether tracked frames carry their own decoded-frame timestamps. */
  get frameClock(): "decoded-frame" | "callback" | "pickup-tick" {
    if (this.trackingProfile === "words" && this.wordClockPolicy === "pickup-tick") return "pickup-tick";
    return this.ownFrames.available ? "decoded-frame" : "callback";
  }
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
        // Startup notifications cannot replace or clear an active frame timer.
        if (ready && (data.type === "warming" || data.type === "ready")) return;
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
          pending.hands(this.withCaptureMetadata(data.frame,pending));
        } else if (data.type === "result") {
          clearTimeout(this.timer);
          Object.assign(this.timings, data.timings, { capture: pending.capture,
            transport: Math.max(0, performance.now() - pending.posted - data.timings.hands - data.timings.auxiliary) });
          this.pending = null; pending.resolve(this.withCaptureMetadata(data.frame,pending));
        }
      };
      worker.postMessage({ type: "init", accelerated: this.accelerated });
    });
  }

  private withCaptureMetadata(frame:VisionFrame,pending:Pending) {
    return this.trackingProfile==="fingerspelling"?{...frame,capturedAt:pending.started,...pending.metadata}:frame;
  }

  private fail(error: Error) {
    this.lastError = error.message;
    // Pixels captured before a tracking fault belong to the interrupted
    // observation stream, even if CPU recovery completes within the age limit.
    this.snapshot?.bitmap.close(); this.snapshot = null; this.snapshotError = null;
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
    let started = performance.now();
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
      let frameTimestamp=timestamp,metadata:Pending["metadata"],bitmap:ImageBitmap;
      if(this.trackingProfile==="fingerspelling"){
        if(!("videoWidth" in video))throw new Error("Fingerspelling requires a video source");
        this.watchDecodedFrames(video);
        if (this.snapshotError) {
          const error = this.snapshotError;
          this.snapshotError = null;
          throw error;
        }
        const sample=this.snapshot;this.snapshot=null;
        if(!sample)return null;
        if(performance.now()-sample.capturedAt>200){sample.bitmap.close();this.stats.stale++;return null;}
        bitmap=sample.bitmap;frameTimestamp=sample.timestamp;started=sample.capturedAt;
        metadata={mediaSlot:sample.mediaSlot,presentedFrames:sample.presentedFrames};
      }else{
        // Opt-in: stamp each frame with its own capture interval rather than
        // the animation tick at which the tracking lane became free.
        const own=this.wordClockPolicy==="capture-time"&&"videoWidth" in video?this.ownFrames.take(video,true):null;
        if(own?.repeat){own.frame.close();this.stats.repeated++;return null;}
        if(own){
          frameTimestamp=this.wordMediaClock.map(own.mediaMs,timestamp);
          try {bitmap=await createImageBitmap(own.frame);} finally {own.frame.close();}
        }else{
          // Opt-in policy whose WebCodecs path is unavailable: keep tick times,
          // but never below a capture-time stamp already sent to the tracker.
          if(this.wordClockPolicy==="capture-time")frameTimestamp=Math.max(timestamp,this.lastWordTimestamp+1);
          bitmap=await createImageBitmap(video);
        }
        if(this.wordClockPolicy==="capture-time")this.lastWordTimestamp=frameTimestamp;
      }
      if (this.closed || this.worker !== captureWorker || this.recovering) { bitmap.close(); return null; }
      const posted = performance.now();
      return await new Promise<VisionFrame | null>((resolve, reject) => {
        this.pending = { resolve, reject, hands: onHands, started, capture: posted - started, posted, metadata };
        this.timer = setTimeout(() => this.fail(new Error("Tracking frame timed out")), 8000);
        try { this.worker!.postMessage({ type: "frame", bitmap, timestamp: frameTimestamp }, [bitmap]); }
        catch (error) { bitmap.close(); clearTimeout(this.timer); this.fail(error as Error); }
      });
    } finally { this.occupied = false; this.idleWaiters.splice(0).forEach(resolve=>resolve()); }
  }

  close() {
    if (this.sourceVideo && this.frameCallback !== null) this.sourceVideo.cancelVideoFrameCallback(this.frameCallback);
    this.snapshot?.bitmap.close();this.snapshot=null;this.snapshotCanvas=null;
    this.sourceVideo = null; this.decodedFrame = null; this.frameCallback = null;
    this.idleWaiters.splice(0).forEach(resolve=>resolve());
    this.closed = true; clearTimeout(this.timer);
    this.cancelStartup?.(new Error("Tracking closed")); this.cancelStartup = null;
    this.worker?.terminate(); this.worker = null;
    this.fallback?.close(); this.fallback = null;
    this.pending?.resolve(null); this.pending = null;
  }
}
