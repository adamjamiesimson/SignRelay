import type { FaceLandmarker, GestureRecognizer, PoseLandmarker } from "@mediapipe/tasks-vision";
import type { Point, VisionFrame } from "./vision-types";

const WASM_PATH = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm";
const GESTURE_MODEL = "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task";
const FACE_MODEL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
const POSE_MODEL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

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

export class VisionEngine {
  private parts: EngineParts;
  private frameIndex = 0;
  private lastFace: Point[] = [];
  private lastPose: Point[] = [];

  private constructor(parts: EngineParts) {
    this.parts = parts;
  }

  static async create(onProgress?: (message: string) => void) {
    onProgress?.("Loading vision runtime");
    const vision = await import("@mediapipe/tasks-vision");
    const files = await vision.FilesetResolver.forVisionTasks(WASM_PATH);

    onProgress?.("Loading hand, face and pose models");
    const [gesture, face, pose] = await Promise.all([
      vision.GestureRecognizer.createFromOptions(files, {
        baseOptions: { modelAssetPath: GESTURE_MODEL, delegate: "CPU" },
        runningMode: "VIDEO",
        numHands: 2,
        minHandDetectionConfidence: 0.55,
        minHandPresenceConfidence: 0.55,
        minTrackingConfidence: 0.55,
        cannedGesturesClassifierOptions: { scoreThreshold: 0.55 },
      }),
      vision.FaceLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: FACE_MODEL, delegate: "CPU" },
        runningMode: "VIDEO",
        numFaces: 1,
        minFaceDetectionConfidence: 0.55,
        minFacePresenceConfidence: 0.55,
        minTrackingConfidence: 0.55,
        outputFaceBlendshapes: true,
      }),
      vision.PoseLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: POSE_MODEL, delegate: "CPU" },
        runningMode: "VIDEO",
        numPoses: 1,
        minPoseDetectionConfidence: 0.55,
        minPosePresenceConfidence: 0.55,
        minTrackingConfidence: 0.55,
      }),
    ]);

    return new VisionEngine({ gesture, face, pose });
  }

  process(video: HTMLVideoElement, timestamp: number): VisionFrame {
    const handResult = this.parts.gesture.recognizeForVideo(video, timestamp);

    if (this.frameIndex % 2 === 0) {
      const faceResult = this.parts.face.detectForVideo(video, timestamp);
      const poseResult = this.parts.pose.detectForVideo(video, timestamp);
      this.lastFace = pickPoints(faceResult.faceLandmarks[0] ?? [], FACE_CUE_INDICES);
      this.lastPose = pickPoints(poseResult.landmarks[0] ?? [], POSE_CUE_INDICES);
    }
    this.frameIndex += 1;

    return {
      timestamp,
      hands: handResult.landmarks.map((landmarks, index) => ({
        landmarks: landmarks.map(toPoint),
        handedness: (handResult.handedness[index]?.[0]?.categoryName as "Left" | "Right") ?? "Unknown",
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

function toPoint(point: { x: number; y: number; z: number; visibility?: number }): Point {
  return { x: point.x, y: point.y, z: point.z, visibility: point.visibility };
}

function pickPoints(
  landmarks: Array<{ x: number; y: number; z: number; visibility?: number }>,
  indices: number[],
) {
  return indices.map((index) => landmarks[index]).filter(Boolean).map(toPoint);
}
