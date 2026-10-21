import plan from "../docs/evaluation/development-collection-plan-2026-10-17.json";

export type CaptureType = "sign" | "no_sign" | "unknown_sign";
export type Hand = "Left" | "Right" | "Both";

export const capturePlan = plan;
export const captureTypes: { id: CaptureType; label: string }[] = [
  { id: "sign", label: "Signed word" },
  { id: "no_sign", label: "Ordinary activity (not signing)" },
  { id: "unknown_sign", label: "Unsupported sign (reviewer selected)" },
];

export function slotLabels(type: CaptureType): string[] {
  if (type === "sign") return plan.signed_glosses;
  if (type === "no_sign") return plan.no_sign_activities;
  if (type === "unknown_sign") return Array.from({ length: plan.unknown_sign_slots }, (_, i) => "Reviewer-selected unknown sign " + (i + 1));
  throw new Error("Unknown capture type");
}

export function takeCount(type: CaptureType): number {
  return type === "sign" ? plan.signed_takes.length : plan.negative_takes;
}

export function captureTrial(participantIndex: number, type: CaptureType, slot: number, take: number) {
  if (!Number.isInteger(participantIndex) || participantIndex < 0 || participantIndex >= plan.participant_ids.length) throw new Error("Invalid participant");
  const labels = slotLabels(type);
  if (!Number.isInteger(slot) || slot < 1 || slot > labels.length) throw new Error("Invalid trial slot");
  if (!Number.isInteger(take) || take < 1 || take > takeCount(type)) throw new Error("Invalid take");
  const participant_id = plan.participant_ids[participantIndex];
  const trial_id = participant_id + "-" + type + "-" + slot + "-" + take;
  return {
    plan_id: plan.plan_id,
    participant_id,
    trial_id,
    trial_type: type,
    evaluation_split: "development" as const,
    expected_gloss: type === "sign" ? plan.signed_glosses[slot - 1] : null,
    instruction: type === "sign" ? plan.signed_takes[take - 1] : labels[slot - 1],
    label: labels[slot - 1],
  };
}

export function videoExtension(mimeType: string) {
  return mimeType.startsWith("video/mp4") ? "mp4" : "webm";
}

export const MIN_RECORDING_MS = 1_000;
export const MAX_RECORDING_MS = 30_000;
export const MAX_RECORDING_BYTES = 100 * 1024 * 1024;
export const CAPTURE_TOOL = "signrelay-field-test-v2";

export type RecordingCheck = { durationMs: number; bytes: number; mimeType: string; interruption: string | null };

/** Reasons a take is unusable as an original recording. Null means usable;
 * usable is not reviewed, approved or known to contain the expected sign. */
export function rejectRecording({ durationMs, bytes, mimeType, interruption }: RecordingCheck): string | null {
  if (interruption) return `The take was interrupted (${interruption}). Discard it and record again.`;
  if (!bytes) return "The recording is empty. Record again.";
  if (bytes > MAX_RECORDING_BYTES) return "The recording exceeded 100 MB. Record a shorter take.";
  if (!/^video\/(?:webm|mp4)\b/.test(mimeType)) return `Unsupported recording format ${mimeType || "(none)"}.`;
  if (!Number.isFinite(durationMs) || durationMs < MIN_RECORDING_MS)
    return "The take was shorter than 1 second, too short for a lead-in, a complete sign and an ending. Record again.";
  if (durationMs > MAX_RECORDING_MS + 2_000) return "The take exceeded 30 seconds. Record again.";
  return null;
}

export async function sha256Hex(blob: Blob): Promise<string | null> {
  if (typeof crypto === "undefined" || !crypto.subtle) return null;
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

export type CapturedTake = {
  trial: ReturnType<typeof captureTrial>; mime: string; bytes: number; sha256: string | null;
  recordedAt: string; durationMs: number; stopReason: "manual" | "time-limit";
  dominantHand: string; physicalHands: string[]; device: string; oovGloss: string | null;
  camera: { width: number | null; height: number | null; frameRate: number | null; facingMode: string | null };
};

/** Pending-review sidecar. The checksum pairs it to exactly one downloaded file. */
export function captureMetadata(take: CapturedTake) {
  const file = take.trial.trial_id + "." + videoExtension(take.mime);
  return {
    schema: 2,
    capture_tool: CAPTURE_TOOL,
    ...take.trial,
    status: "pending-independent-fluent-review",
    original_recording_file: file,
    mime_type: take.mime,
    bytes: take.bytes,
    recording_sha256: take.sha256,
    duration_ms: Math.round(take.durationMs),
    stop_reason: take.stopReason,
    recorded_at: take.recordedAt,
    dominant_hand: take.dominantHand,
    physical_hands: take.physicalHands,
    device: take.device,
    // Resolution and rate only: browser camera labels can contain a person's name.
    camera_settings: take.camera,
    claimed_unsupported_gloss: take.oovGloss,
    oov_vocabulary_verified: false,
    consent_documentation: "Store consent reference separately in private intake. Checkbox is not proof of consent.",
    review: { status: "pending", reviewer_id: null, fluent_asl: false, blinded_to_predictions: false },
    note: "Downloaded original browser recording. Not scored or reviewed. This is a development take, never a holdout.",
  };
}
