import type { AslV31Diagnostics } from "./asl-v31-diagnostics";
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
  /** Training-ordered V3.1 features from the same processed camera image. */
  aslV3Features?: Float32Array;
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
  /** V3.1 stage counters, only when the page asked for diagnostics (?perf). */
  diagnostics?: AslV31Diagnostics;
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

export type WorkerSuggestion = Omit<WorkerConfirmation, "type" | "source"> & { type: "suggestion"; source: "model" };

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
  | { type: "templates"; language: LanguageId; templates: CalibrationTemplate[]; aslEngine?: "v3.1"; diagnostics?: boolean }
) & { session?: number; frameId?: number };

export type DetectionStatus = {
  person: boolean;
  hands: boolean;
  face: boolean;
  pose: boolean;
};
