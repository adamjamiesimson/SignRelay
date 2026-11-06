import type { LanguageId } from "./model-adapters";
import type { PackedTemplates } from "./template-transport";

export type Point = {
  x: number;
  y: number;
  z: number;
  visibility?: number;
};

export type HandObservation = {
  landmarks: Point[];
  handedness: "Left" | "Right" | "Unknown";
  gesture: string;
  gestureScore: number;
};

export type VisionFrame = {
  timestamp: number;
  hands: HandObservation[];
  face: Point[];
  pose: Point[];
};

function validPoints(points: unknown): points is Point[] {
  if (!Array.isArray(points)) return false;
  for (const point of points) {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z)
      || (point.visibility !== undefined && !Number.isFinite(point.visibility))) return false;
  }
  return true;
}

/** Guard the two worker boundaries before reading, drawing or storing landmarks. */
export function validVisionFrame(value: unknown): value is VisionFrame {
  if (!value || typeof value !== "object") return false;
  const frame = value as VisionFrame;
  if (!Number.isFinite(frame.timestamp) || frame.timestamp < 0 || !Array.isArray(frame.hands)) return false;
  for (const hand of frame.hands) if (!hand || !validPoints(hand.landmarks)) return false;
  return validPoints(frame.face) && validPoints(frame.pose);
}

export type WorkerAnalysis = {
  type: "analysis";
  session?: number;
  frameId?: number;
  state: "listening" | "processing" | "uncertain";
  candidate: string | null;
  confidence: number;
  bufferSize: number;
  feedback?: string;
  source?: "personal" | "starter" | "model";
  motionReason?: string;
  /** Synchronous analysis only; asynchronous neural/template work is separate. */
  processingMs?: number;
  modelMs?: number;
  personalMs?: number;
  referenceMs?: number;
};

export type WorkerConfirmation = {
  type: "confirmed";
  session?: number;
  text: string;
  gloss: string;
  confidence: number;
  timestamp: number;
  source?: "personal" | "starter" | "model";
};

/** A research-model word that must be deliberately accepted before it enters
 * the transcript (lib/model-output-policy.ts). Never spoken or auto-inserted. */
export type WorkerSuggestion = {
  type: "suggested";
  session?: number;
  /** Unique within a worker; the workspace accepts only the suggestion on screen. */
  id: string;
  language: LanguageId;
  text: string;
  gloss: string;
  confidence: number;
  timestamp: number;
  source: "model";
};

export type WorkerMessage = WorkerAnalysis | WorkerConfirmation | WorkerSuggestion
  | { type: "fault"; session?: number; message: string };

export type CalibrationTemplate = {
  id: string;
  /** Absent on older saved examples and the published PSL reference bundle. */
  normalization?: "trajectory-v3";
  /** Older records without this field are treated as ASL for compatibility. */
  language?: LanguageId;
  gloss: string;
  text: string;
  createdAt: number;
  frames: number[][];
};

export type WorkerInput = (
  | { type: "frame"; frame: VisionFrame }
  | { type: "reset" }
  // RecognitionSession sends PackedTemplates; plain arrays remain accepted.
  | { type: "templates"; language: LanguageId; templates: CalibrationTemplate[] | PackedTemplates }
) & { session?: number; frameId?: number; measure?: boolean };

export type DetectionStatus = {
  person: boolean;
  hands: boolean;
  face: boolean;
  pose: boolean;
};
