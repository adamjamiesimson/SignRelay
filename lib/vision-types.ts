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
  state: "listening" | "processing" | "uncertain";
  candidate: string | null;
  confidence: number;
  bufferSize: number;
};

export type WorkerConfirmation = {
  type: "confirmed";
  text: string;
  gloss: string;
  confidence: number;
  timestamp: number;
};

export type WorkerMessage = WorkerAnalysis | WorkerConfirmation;

export type CalibrationTemplate = {
  id: string;
  gloss: string;
  text: string;
  createdAt: number;
  frames: number[][];
};

export type WorkerInput =
  | { type: "frame"; frame: VisionFrame }
  | { type: "reset" }
  | { type: "templates"; templates: CalibrationTemplate[] };

export type DetectionStatus = {
  person: boolean;
  hands: boolean;
  face: boolean;
  pose: boolean;
};
