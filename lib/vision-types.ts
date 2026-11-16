import type { LanguageId } from "./model-adapters";

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
  /** Why the ASL movement gate answered as it did: a code, never landmarks. */
  motionDetail?: string;
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

/** A word whose only evidence is a research model. It is offered to the person
 * and never enters the transcript, is announced as confirmed or is spoken
 * unless they add it. */
export type WorkerSuggestion = Omit<WorkerConfirmation, "type" | "source"> & { type: "suggested"; source: "model" };

export type WorkerMessage = WorkerAnalysis | WorkerConfirmation | WorkerSuggestion
  | { type: "fault"; session?: number; message: string };

export type CalibrationTemplate = {
  id: string;
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
  | { type: "templates"; language: LanguageId; templates: CalibrationTemplate[] }
) & { session?: number; frameId?: number };

export type DetectionStatus = {
  person: boolean;
  hands: boolean;
  face: boolean;
  pose: boolean;
};
