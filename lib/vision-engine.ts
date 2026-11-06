import type { FaceLandmarker, GestureRecognizer, PoseLandmarker } from "@mediapipe/tasks-vision";
import type { Point, VisionFrame } from "./vision-types";
import { VISION_ASSET_SOURCES } from "./vision-runtime.mjs";

type AssetSource = typeof VISION_ASSET_SOURCES[number];

const FACE_CUE_INDICES = [
  0, 4, 10, 13, 14, 17, 33, 61, 70, 105, 133, 145, 159, 263, 291, 300,
  334, 362, 374, 386,
];

// Retain the complete 33-point MediaPipe pose. The ASL-1000 Pose-TGCN adapter
// maps the relevant upper-body points to its 13-point OpenPose body contract.
const POSE_CUE_INDICES = Array.from({ length: 33 }, (_, index) => index);

type EngineParts = {
  gesture: GestureRecognizer;
  face: FaceLandmarker;
  pose: PoseLandmarker;
};

export type VisionTimings = { hands: number; auxiliary: number; face?: number; pose?: number };
/** "together" (production): face and pose on the same auxiliary turn.
 * "alternate" (research only, never selected by the app): one per turn. */
export type AuxSchedule = "together" | "alternate";
type Source = HTMLVideoElement | HTMLCanvasElement | ImageBitmap;

export class VisionEngine {
  private parts: EngineParts;
  /** Which copy of the pinned runtime loaded: "self-hosted" or "cdn". */
  readonly assetSource: AssetSource["id"];
  private lastAuxTimestamp = -Infinity;
  private handFramesSinceAux = 2;
  private lastFace: Point[] = [];
  private lastPose: Point[] = [];
  readonly timings: Required<VisionTimings> = { hands: 0, auxiliary: 0, face: 0, pose: 0 };
  private nextAux: "face" | "pose" = "face";
  auxSchedule: AuxSchedule = "together";

  private constructor(parts: EngineParts, assetSource: AssetSource["id"], readonly delegate: "GPU" | "CPU") {
    this.parts = parts;
    this.assetSource = assetSource;
  }

  /** Self-hosted assets first, so a venue without CDN access still works;
   * the CDN holds the same pinned bytes and is only a fallback. */
  static async create(onProgress?: (message: string) => void, accelerated = false) {
    onProgress?.("Loading vision runtime");
    const vision = await import("@mediapipe/tasks-vision");
    let lastError: unknown = new Error("Vision models could not start");
    for (const source of VISION_ASSET_SOURCES) {
      for (const delegate of accelerated ? ["GPU", "CPU"] as const : ["CPU"] as const) {
        try {
          const parts = await VisionEngine.load(vision, source, delegate, onProgress);
          if (!parts.gesture || !parts.face || !parts.pose) throw new Error("Vision models could not start");
          return new VisionEngine({ gesture: parts.gesture, face: parts.face, pose: parts.pose }, source.id, delegate);
        } catch (error) {
          lastError = error;
        }
      }
    }
    throw lastError;
  }

  /** Diagnostic lanes use the same tasks and options as the combined tracker. */
  static async load(vision: typeof import("@mediapipe/tasks-vision"), source: AssetSource, delegate: "GPU" | "CPU", onProgress?: (message: string) => void,
    lane: "combined" | "hands" | "auxiliary" = "combined") {
    const files = await vision.FilesetResolver.forVisionTasks(source.wasm);

    onProgress?.("Loading hand, face and pose models");
    const results = await Promise.allSettled([
      lane === "auxiliary" ? null : vision.GestureRecognizer.createFromOptions(files, {
        baseOptions: { modelAssetPath: source.models.gesture, delegate },
        ...(typeof OffscreenCanvas !== "undefined" ? { canvas: new OffscreenCanvas(1, 1) } : {}),
        runningMode: "VIDEO",
        numHands: 2,
        minHandDetectionConfidence: 0.55,
        minHandPresenceConfidence: 0.55,
        minTrackingConfidence: 0.55,
        cannedGesturesClassifierOptions: { scoreThreshold: 0.55 },
      }),
      lane === "hands" ? null : vision.FaceLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: source.models.face, delegate },
        ...(typeof OffscreenCanvas !== "undefined" ? { canvas: new OffscreenCanvas(1, 1) } : {}),
        runningMode: "VIDEO",
        numFaces: 1,
        minFaceDetectionConfidence: 0.55,
        minFacePresenceConfidence: 0.55,
        minTrackingConfidence: 0.55,
        outputFaceBlendshapes: false,
      }),
      lane === "hands" ? null : vision.PoseLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: source.models.pose, delegate },
        ...(typeof OffscreenCanvas !== "undefined" ? { canvas: new OffscreenCanvas(1, 1) } : {}),
        runningMode: "VIDEO",
        numPoses: 1,
        minPoseDetectionConfidence: 0.55,
        minPosePresenceConfidence: 0.55,
        minTrackingConfidence: 0.55,
      }),
    ]);

    const failed = results.find(result => result.status === "rejected");
    if (failed) {
      for (const result of results) if (result.status === "fulfilled") result.value?.close();
      throw failed.reason;
    }
    const [gesture, face, pose] = results;
    if (gesture.status !== "fulfilled" || face.status !== "fulfilled" || pose.status !== "fulfilled") {
      throw new Error("Vision models could not start");
    }
    return { gesture: gesture.value, face: face.value, pose: pose.value };
  }

  process(video: Source, timestamp: number, onHands?: (frame: VisionFrame) => void): VisionFrame {
    const started = performance.now();
    const handResult = this.parts.gesture.recognizeForVideo(video, timestamp);
    this.timings.hands = performance.now() - started;
    const frame: VisionFrame = {
      timestamp,
      hands: handObservations(handResult),
      face: this.lastFace, pose: this.lastPose,
    };
    // Publish hands before face/pose work. In the tracking worker this message
    // can paint on the UI thread while auxiliary inference is still running.
    onHands?.(frame);
    const auxiliaryStarted = performance.now();
    this.handFramesSinceAux++;
    // Leave alternate frames for hands even when CPU inference is already slow.
    this.timings.face = 0; this.timings.pose = 0;
    // "alternate" halves the gap: each part still refreshes every other turn.
    const gap = this.auxSchedule === "alternate" ? 75 : 150;
    if (this.handFramesSinceAux >= 2 && timestamp - this.lastAuxTimestamp >= gap) {
      const runFace = this.auxSchedule === "together" || this.nextAux === "face";
      const runPose = this.auxSchedule === "together" || this.nextAux === "pose";
      if (runFace) {
        const faceStarted = performance.now();
        const faceResult = this.parts.face.detectForVideo(video, timestamp);
        this.lastFace = faceCues(faceResult);
        this.timings.face = performance.now() - faceStarted;
      }
      if (runPose) {
        const poseStarted = performance.now();
        const poseResult = this.parts.pose.detectForVideo(video, timestamp);
        this.lastPose = poseCues(poseResult);
        this.timings.pose = performance.now() - poseStarted;
      }
      this.nextAux = this.nextAux === "face" ? "pose" : "face";
      this.lastAuxTimestamp = timestamp;
      this.handFramesSinceAux = 0;
    }

    this.timings.auxiliary = performance.now() - auxiliaryStarted;
    return { ...frame, face: this.lastFace, pose: this.lastPose };
  }

  close() {
    this.parts.gesture.close();
    this.parts.face.close();
    this.parts.pose.close();
  }
}

export async function loadVisionTasks(lane: "hands" | "auxiliary") {
  return VisionEngine.load(await import("@mediapipe/tasks-vision"), VISION_ASSET_SOURCES[0], "CPU", undefined, lane);
}

export function handObservations(result: ReturnType<GestureRecognizer["recognizeForVideo"]>): VisionFrame["hands"] {
  return result.landmarks.map((landmarks, index) => ({ landmarks: landmarks.map(toPoint),
    handedness: taskHandedness(result.handedness[index]?.[0]?.categoryName),
    gesture: result.gestures[index]?.[0]?.categoryName ?? "None",
    gestureScore: result.gestures[index]?.[0]?.score ?? 0 }));
}

export const faceCues = (result: ReturnType<FaceLandmarker["detectForVideo"]>) => pickPoints(result.faceLandmarks[0] ?? [], FACE_CUE_INDICES);
export const poseCues = (result: ReturnType<PoseLandmarker["detectForVideo"]>) => pickPoints(result.landmarks[0] ?? [], POSE_CUE_INDICES);

export function taskHandedness(label: string | undefined): "Left" | "Right" | "Unknown" {
  return label === "Left" || label === "Right" ? label : "Unknown";
}

function toPoint(point: { x: number; y: number; z: number; visibility?: number }): Point {
  return { x: point.x, y: point.y, z: point.z, visibility: point.visibility };
}

function pickPoints(
  landmarks: Array<{ x: number; y: number; z: number; visibility?: number }>,
  indices: number[],
) {
  return indices.map((index) => landmarks[index]).filter(Boolean).map(toPoint);
}
