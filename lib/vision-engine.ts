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

/** The tracker needs strictly increasing timestamps. Camera frames are at least
 * 33 ms apart, so a retry 1 ms later can never collide with the next frame. */
const REACQUIRE_OFFSET_MS = 1;

/** Tracker settings. The defaults are what the app ships; anything else is for
 * evaluation harnesses (scripts/diagnostics), which compare variants on the
 * same recordings before a setting is allowed to change here. */
export type VisionEngineOptions = {
  /** Ask again for the same image when region tracking loses a hand it had on
   * the previous frame. OFF in production: on translated test photos it removes
   * nearly every dropped frame, but on the real development clips it recovered
   * one frame in total and that frame produced a new wrong word
   * (docs/evaluation/hand-reacquisition-2026-11-16.md). */
  reacquireLostHands?: boolean;
  handDetectionConfidence?: number;
  handPresenceConfidence?: number;
  handTrackingConfidence?: number;
};
export const PRODUCTION_TRACKER: Readonly<Required<VisionEngineOptions>> = Object.freeze({
  reacquireLostHands: false, handDetectionConfidence: 0.55, handPresenceConfidence: 0.55, handTrackingConfidence: 0.55,
});

type EngineParts = {
  gesture: GestureRecognizer;
  face: FaceLandmarker;
  pose: PoseLandmarker;
};

export class VisionEngine {
  private parts: EngineParts;
  /** Which copy of the pinned runtime loaded: "self-hosted" or "cdn". */
  readonly assetSource: AssetSource["id"];
  private lastAuxTimestamp = -Infinity;
  private handFramesSinceAux = 2;
  private lastFace: Point[] = [];
  private lastPose: Point[] = [];
  private hadHands = false;
  /** Evaluation counters: frames where tracking lost a hand it had on the
   * previous frame, and how many of those a same-frame retry got back. */
  readonly reacquisition = { attempts: 0, recovered: 0 };
  private readonly reacquire: boolean;

  private constructor(parts: EngineParts, assetSource: AssetSource["id"], reacquire: boolean) {
    this.parts = parts;
    this.assetSource = assetSource;
    this.reacquire = reacquire;
  }

  /** Self-hosted assets first, so a venue without CDN access still works;
   * the CDN holds the same pinned bytes and is only a fallback. */
  static async create(onProgress?: (message: string) => void, options: VisionEngineOptions = {}) {
    const tracker = { ...PRODUCTION_TRACKER, ...options };
    onProgress?.("Loading vision runtime");
    const vision = await import("@mediapipe/tasks-vision");
    let lastError: unknown = new Error("Vision models could not start");
    for (const source of VISION_ASSET_SOURCES) {
      try {
        return new VisionEngine(await VisionEngine.load(vision, source, tracker, onProgress), source.id, tracker.reacquireLostHands);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }

  private static async load(vision: typeof import("@mediapipe/tasks-vision"), source: AssetSource,
    tracker: Required<VisionEngineOptions>, onProgress?: (message: string) => void) {
    const files = await vision.FilesetResolver.forVisionTasks(source.wasm);

    onProgress?.("Loading hand, face and pose models");
    const results = await Promise.allSettled([
      vision.GestureRecognizer.createFromOptions(files, {
        baseOptions: { modelAssetPath: source.models.gesture, delegate: "CPU" },
        runningMode: "VIDEO",
        numHands: 2,
        minHandDetectionConfidence: tracker.handDetectionConfidence,
        minHandPresenceConfidence: tracker.handPresenceConfidence,
        minTrackingConfidence: tracker.handTrackingConfidence,
        cannedGesturesClassifierOptions: { scoreThreshold: 0.55 },
      }),
      vision.FaceLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: source.models.face, delegate: "CPU" },
        runningMode: "VIDEO",
        numFaces: 1,
        minFaceDetectionConfidence: 0.55,
        minFacePresenceConfidence: 0.55,
        minTrackingConfidence: 0.55,
        outputFaceBlendshapes: false,
      }),
      vision.PoseLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: source.models.pose, delegate: "CPU" },
        runningMode: "VIDEO",
        numPoses: 1,
        minPoseDetectionConfidence: 0.55,
        minPosePresenceConfidence: 0.55,
        minTrackingConfidence: 0.55,
      }),
    ]);

    const failed = results.find(result => result.status === "rejected");
    if (failed) {
      for (const result of results) if (result.status === "fulfilled") result.value.close();
      throw failed.reason;
    }
    const [gesture, face, pose] = results;
    if (gesture.status !== "fulfilled" || face.status !== "fulfilled" || pose.status !== "fulfilled") {
      throw new Error("Vision models could not start");
    }
    return { gesture: gesture.value, face: face.value, pose: pose.value };
  }

  process(video: HTMLVideoElement | HTMLCanvasElement, timestamp: number): VisionFrame {
    let handResult = this.parts.gesture.recognizeForVideo(video, timestamp);
    // Evaluation option, off in production. In VIDEO mode the hand model
    // follows the region predicted from the last frame; a fast hand can leave
    // that region, the frame comes back empty and detection only restarts on
    // the next frame. Asking again for the same image runs palm detection on
    // it. One retry per loss; every landmark comes from the current image.
    if (this.reacquire && !handResult.landmarks.length && this.hadHands) {
      this.reacquisition.attempts++;
      handResult = this.parts.gesture.recognizeForVideo(video, timestamp + REACQUIRE_OFFSET_MS);
      if (handResult.landmarks.length) this.reacquisition.recovered++;
    }
    this.hadHands = handResult.landmarks.length > 0;
    this.handFramesSinceAux++;
    // Leave alternate frames for hands even when CPU inference is already slow.
    if (this.handFramesSinceAux >= 2 && timestamp - this.lastAuxTimestamp >= 150) {
      const faceResult = this.parts.face.detectForVideo(video, timestamp);
      const poseResult = this.parts.pose.detectForVideo(video, timestamp);
      this.lastFace = pickPoints(faceResult.faceLandmarks[0] ?? [], FACE_CUE_INDICES);
      this.lastPose = pickPoints(poseResult.landmarks[0] ?? [], POSE_CUE_INDICES);
      this.lastAuxTimestamp = timestamp;
      this.handFramesSinceAux = 0;
    }

    return {
      timestamp,
      hands: handResult.landmarks.map((landmarks, index) => ({
        landmarks: landmarks.map(toPoint),
        // Preserve Tasks labels. CSS preview mirroring never changes this input.
        handedness: taskHandedness(handResult.handedness[index]?.[0]?.categoryName),
        gesture: handResult.gestures[index]?.[0]?.categoryName ?? "None",
        gestureScore: handResult.gestures[index]?.[0]?.score ?? 0,
      })),
      face: this.lastFace,
      pose: this.lastPose,
    };
  }

  close() {
    this.parts.gesture.close();
    this.parts.face.close();
    this.parts.pose.close();
  }
}

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
