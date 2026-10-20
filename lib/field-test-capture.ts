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
