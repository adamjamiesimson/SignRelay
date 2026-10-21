/** One honest status for the live workspace. A tentative candidate is never
 * presented as a translation, and nothing claims to be listening while the
 * camera is off, starting, denied or broken. */
export type CameraPhase = "idle" | "requesting" | "loading" | "active" | "denied" | "error";
export type StatusKey = "camera-off" | "permission" | "starting" | "camera-denied" | "camera-error" | "unavailable"
  | "waiting-for-hands" | "building-context" | "following-movement" | "checking-sign" | "no-confident-match";

export type StatusInput = {
  camera: CameraPhase; unavailable: boolean; handsVisible: boolean;
  motionReason?: string | null; candidate: string | null; bufferSize: number;
};

const LABELS: Record<StatusKey, { chip: string; detail: string; tone: "paused" | "listening" | "processing" | "uncertain" }> = {
  "camera-off": { chip: "camera off", detail: "Start the camera to begin", tone: "paused" },
  permission: { chip: "waiting for permission", detail: "Allow camera access to begin", tone: "paused" },
  starting: { chip: "starting", detail: "Preparing hand tracking…", tone: "paused" },
  "camera-denied": { chip: "camera blocked", detail: "Camera permission was denied", tone: "paused" },
  "camera-error": { chip: "camera unavailable", detail: "The camera is unavailable", tone: "paused" },
  unavailable: { chip: "recognition unavailable", detail: "Recognition unavailable", tone: "paused" },
  "waiting-for-hands": { chip: "waiting for hands", detail: "Waiting for hands in frame", tone: "listening" },
  "building-context": { chip: "watching", detail: "Building movement context…", tone: "listening" },
  "following-movement": { chip: "following movement", detail: "Following your movement…", tone: "processing" },
  "checking-sign": { chip: "checking", detail: "Checking a possible match…", tone: "processing" },
  "no-confident-match": { chip: "no confident match", detail: "No confident match", tone: "uncertain" },
};

export function recognitionStatus(input: StatusInput) {
  let key: StatusKey;
  if (input.camera === "idle") key = "camera-off";
  else if (input.camera === "requesting") key = "permission";
  else if (input.camera === "loading") key = "starting";
  else if (input.camera === "denied") key = "camera-denied";
  else if (input.camera === "error") key = "camera-error";
  else if (input.unavailable) key = "unavailable";
  else if (!input.handsVisible) key = "waiting-for-hands";
  else if (input.candidate) key = "checking-sign";
  else if (input.motionReason === "moving") key = "following-movement";
  else if (input.bufferSize < 10) key = "building-context";
  else key = "no-confident-match";
  return { key, ...LABELS[key] };
}
