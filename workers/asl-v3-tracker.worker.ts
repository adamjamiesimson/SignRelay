import { FaceLandmarker, FilesetResolver, HandLandmarker, PoseLandmarker, type HandLandmarkerResult, type PoseLandmarkerResult } from "@mediapipe/tasks-vision";
import { gatherFrame } from "../engine-v3/web/preprocess.mjs";
import type { AslV3TrackerInput, AslV3TrackerOutput } from "../lib/asl-v3-tracker";
import { MAX_TRACKING_GAP_MS } from "../lib/frame-timing";
import { faceCuePoints } from "../lib/vision-engine";
import { LOCAL_MODEL_PATH, LOCAL_WASM_PATH, VISION_MODELS } from "../lib/vision-runtime.mjs";
import type { Point, VisionFrame } from "../lib/vision-types";

type Delegate = "CPU" | "GPU";
type TrackingTasks = { hand: HandLandmarker; pose: PoseLandmarker };
type TaskFile = { file: string; bytes: number; sha256: string };

let tasks: TrackingTasks | undefined;
let faceTask: FaceLandmarker | undefined;
let canvas: OffscreenCanvas | undefined;
let context: OffscreenCanvasRenderingContext2D | null;
let lastTaskTimestamp = -Infinity;
let lastPoseTimestamp = -Infinity;
let lastFaceTimestamp = -Infinity;
let framesTracked = 0;
let handFramesSinceFace = 2;
let lastPose: PoseLandmarkerResult | null = null;
let lastFace: Point[] = [];

async function loadTask(file: TaskFile) {
  const response = await fetch(new URL(`${LOCAL_MODEL_PATH}/${file.file}`, self.location.origin));
  if (!response.ok) throw new Error(`${file.file} could not load (HTTP ${response.status})`);
  const buffer = await response.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  const sha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  if (buffer.byteLength !== file.bytes || sha256 !== file.sha256) throw new Error(`${file.file} fingerprint mismatch`);
  return new Uint8Array(buffer);
}

async function initialize(preferred?: Delegate) {
  if (typeof OffscreenCanvas !== "function") throw new Error("This browser does not provide worker canvas support for ASL tracking");
  const [files, handBuffer, poseBuffer, faceBuffer] = await Promise.all([
    FilesetResolver.forVisionTasks(new URL(LOCAL_WASM_PATH, self.location.origin).href),
    loadTask(VISION_MODELS.hand),
    loadTask(VISION_MODELS.pose),
    loadTask(VISION_MODELS.face),
  ]);
  async function start(delegate: Delegate) {
    const results = await Promise.allSettled([
      HandLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetBuffer: handBuffer, delegate }, runningMode: "VIDEO", numHands: 2,
      }),
      PoseLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetBuffer: poseBuffer, delegate }, runningMode: "VIDEO", numPoses: 1,
      }),
    ]);
    const [hand, pose] = results;
    if (hand.status === "fulfilled" && pose.status === "fulfilled") return { hand: hand.value, pose: pose.value };
    for (const result of results) if (result.status === "fulfilled") result.value.close();
    throw hand.status === "rejected" ? hand.reason : pose.status === "rejected" ? pose.reason : new Error("Tracking models could not start");
  }

  let delegate = preferred ?? await probeDelegate(start);
  try {
    tasks = await start(delegate);
  } catch (error) {
    if (delegate === "CPU") throw error;
    delegate = "CPU";
    tasks = await start(delegate);
  }
  // The V3.1 model is face-free. Keep only the existing UI/calibration cues.
  try {
    faceTask = await FaceLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetBuffer: faceBuffer, delegate: "CPU" },
      runningMode: "VIDEO",
      numFaces: 1,
      minFaceDetectionConfidence: 0.55,
      minFacePresenceConfidence: 0.55,
      minTrackingConfidence: 0.55,
      outputFaceBlendshapes: false,
    });
  } catch (error) {
    tasks.hand.close();
    tasks.pose.close();
    throw error;
  }
  return delegate;
}

async function probeDelegate(start: (delegate: Delegate) => Promise<TrackingTasks>): Promise<Delegate> {
  // Use the lab's neutral frame, three warm-up frames and eight timed frames.
  // A software renderer cannot accelerate the tracking tasks. Avoid its
  // synchronous shader/readback stalls before benchmarking actual hardware.
  const graphics = new OffscreenCanvas(1, 1).getContext("webgl2");
  if (!graphics) return "CPU";
  const rendererInfo = graphics.getExtension("WEBGL_debug_renderer_info");
  const renderer = String(graphics.getParameter(rendererInfo ? rendererInfo.UNMASKED_RENDERER_WEBGL : graphics.RENDERER));
  graphics.getExtension("WEBGL_lose_context")?.loseContext();
  if (/SwiftShader|llvmpipe|softpipe|software|Microsoft Basic Render/i.test(renderer)) return "CPU";

  const probe = new OffscreenCanvas(640, 480);
  const context = probe.getContext("2d");
  if (!context) return "CPU";
  context.fillStyle = "#808080";
  context.fillRect(0, 0, probe.width, probe.height);
  async function time(delegate: Delegate, budgetMs = Infinity) {
    let candidate: TrackingTasks | undefined;
    try {
      candidate = await start(delegate);
      const { hand, pose } = candidate;
      const probeStartedAt = performance.now();
      for (let t = 1; t <= 3; t++) {
        hand.detectForVideo(probe, t);
        pose.detectForVideo(probe, t);
        if (performance.now() - probeStartedAt > budgetMs) return Infinity;
      }
      const startedAt = performance.now();
      for (let t = 4; t <= 11; t++) {
        hand.detectForVideo(probe, t);
        pose.detectForVideo(probe, t);
        if (performance.now() - probeStartedAt > budgetMs) return Infinity;
      }
      return performance.now() - startedAt;
    } catch {
      return Infinity;
    } finally {
      candidate?.hand.close();
      candidate?.pose.close();
    }
  }
  const cpu = await time("CPU");
  // Software WebGL can spend seconds per probe frame. Stop once GPU work
  // exceeds the CPU benchmark budget, with room for hardware shader warm-up.
  const gpu = await time("GPU", Number.isFinite(cpu) ? Math.max(1500, cpu * 2) : 5000);
  return gpu < cpu ? "GPU" : "CPU";
}

function trackerFrame(hands: HandLandmarkerResult, pose: PoseLandmarkerResult | null,
  width: number, height: number, timestamp: number): VisionFrame & { aslV3Features: Float32Array } {
  const toPoint = ({ x, y, z, visibility }: Point): Point => ({ x, y, z, visibility });
  return {
    timestamp,
    hands: hands.landmarks.map((points, index) => {
      const label = hands.handedness[index]?.[0]?.categoryName;
      return {
        landmarks: points.map(toPoint),
        handedness: label === "Left" || label === "Right" ? label : "Unknown",
        gesture: "None",
        gestureScore: 0,
      };
    }),
    face: timestamp - lastFaceTimestamp <= MAX_TRACKING_GAP_MS ? lastFace : [],
    pose: pose?.landmarks[0]?.map(toPoint) ?? [],
    aslV3Features: gatherFrame(hands, pose, null, width, height),
  };
}

function track({ image, width, height, timestamp }: Extract<AslV3TrackerInput, { type: "frame" }>) {
  if (!tasks) throw new Error("ASL tracking worker is not initialized");
  if (!canvas || canvas.width !== width || canvas.height !== height) {
    canvas = new OffscreenCanvas(width, height);
    context = canvas.getContext("2d");
  }
  if (!context || !canvas) throw new Error("Could not read ASL camera frames");
  context.drawImage(image, 0, 0, width, height);
  const taskTimestamp = Math.max(Math.round(timestamp), lastTaskTimestamp + 1);
  lastTaskTimestamp = taskTimestamp;
  const hands = tasks.hand.detectForVideo(canvas, taskTimestamp);
  if (++framesTracked % 2 === 0 || !lastPose || timestamp - lastPoseTimestamp > MAX_TRACKING_GAP_MS) {
    lastPose = null;
    lastPose = tasks.pose.detectForVideo(canvas, taskTimestamp);
    lastPoseTimestamp = timestamp;
  }
  if (++handFramesSinceFace >= 2 && timestamp - lastFaceTimestamp >= 150 && faceTask) {
    lastFace = [];
    lastFace = faceCuePoints(faceTask.detectForVideo(canvas, taskTimestamp).faceLandmarks[0] ?? []);
    lastFaceTimestamp = timestamp;
    handFramesSinceFace = 0;
  }
  return trackerFrame(hands, lastPose, width, height, timestamp);
}

self.onmessage = async ({ data }: MessageEvent<AslV3TrackerInput>) => {
  try {
    if (data.type === "init") {
      const delegate = await initialize(data.delegate);
      self.postMessage({ type: "ready", delegate } satisfies AslV3TrackerOutput);
    } else if (data.type === "reset") {
      framesTracked = 0;
      lastPose = null;
      handFramesSinceFace = 2;
      lastFaceTimestamp = -Infinity;
      lastFace = [];
    } else {
      const startedAt = performance.now();
      const frame = track(data);
      self.postMessage({ type: "frame", id: data.id, frame, trackingMs: performance.now() - startedAt } satisfies AslV3TrackerOutput,
        [frame.aslV3Features.buffer]);
    }
  } catch (error) {
    self.postMessage({ type: "error", id: data.type === "frame" ? data.id : undefined,
      message: error instanceof Error ? error.message : String(error) } satisfies AslV3TrackerOutput);
  } finally {
    if (data.type === "frame") data.image.close();
  }
};
/// <reference lib="webworker" />

