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
