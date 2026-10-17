// Review metadata is a human attestation, never an automated claim of fluency.
import { signerKey } from "./evaluation-manifest.mjs";
const normalize = value => typeof value === "string" ? value.normalize("NFC").trim().toUpperCase().replace(/[^\p{L}\p{N}]/gu, "") : "";
const text = value => typeof value === "string" && value.trim().length > 0;
const pseudonym = value => typeof value === "string" && /^[\w.-]{1,64}$/.test(value);

export function makeDevelopmentIntake(plan) {
  if (plan.schema !== 1 || !pseudonym(plan.plan_id) || !Array.isArray(plan.participant_ids)
    || plan.participant_ids.length < 2 || new Set(plan.participant_ids).size !== plan.participant_ids.length
    || plan.participant_ids.some(id => !pseudonym(id)) || !plan.signed_glosses?.length
    || !plan.signed_takes?.length || !plan.no_sign_activities?.length
    || !Number.isInteger(plan.negative_takes) || plan.negative_takes < 1
    || !Number.isInteger(plan.unknown_sign_slots) || plan.unknown_sign_slots < 1) throw new Error("Invalid collection plan");
  const trials = [];
  const add = (participant_id, kind, slot, take, expected_gloss, instruction) => {
    const trial_id = `${participant_id}-${kind}-${slot}-${take}`;
    trials.push({ trial_id, participant_id, language: "asl", evaluation_split: "development", trial_type: kind,
      expected_gloss, collection_slot: `${kind}-${slot}`, take, instruction,
      file: `evaluation/videos/${plan.plan_id}/${trial_id}.mp4`, source: null, license: null,
      consent_reference: null, recording_group: null, physical_hands: [], device: null,
      original_unmodified_take: false, review: { status: "pending", reviewer_id: null,
        fluent_asl: false, independent_of_participant: false, blinded_to_predictions: false,
        actual_gloss: null, activity_confirmed: false, variant_notes: null, reviewed_on: null } });
  };
  for (const participant of plan.participant_ids) {
    plan.signed_glosses.forEach((gloss, i) => plan.signed_takes.forEach((pace, take) => add(participant, "sign", i + 1, take + 1, gloss, pace)));
    plan.no_sign_activities.forEach((activity, i) => {
      for (let take = 1; take <= plan.negative_takes; take++) add(participant, "no_sign", i + 1, take, null, activity);
    });
    for (let slot = 1; slot <= plan.unknown_sign_slots; slot++) for (let take = 1; take <= plan.negative_takes; take++)
      add(participant, "unknown_sign", slot, take, null, "Reviewer-selected unsupported ASL sign; identify gloss before replay");
  }
  if (plan.planned_counts) {
    const actual = { signed: trials.filter(row => row.trial_type === "sign").length,
      no_sign: trials.filter(row => row.trial_type === "no_sign").length,
      unknown_sign: trials.filter(row => row.trial_type === "unknown_sign").length, total: trials.length };
    if (Object.keys(actual).some(key => actual[key] !== plan.planned_counts[key])) throw new Error("Plan counts differ from generated collection slots");
  }
  return { schema: 1, plan_id: plan.plan_id, status: "awaiting-recordings-and-human-review",
    participants: plan.participant_ids.map(participant_id => ({ participant_id, dominant_hand: null })), trials };
}

export function validateReviewedDevelopmentRows(rows, vocabulary) {
  for (const row of rows) {
    const fail = message => { throw new Error(`${row.trial_id}: ${message}`); };
    const review = row.independent_review;
    if (!["sign", "no_sign", "unknown_sign"].includes(row.trial_type)) fail("invalid reviewed trial type");
    if (row.evaluation_split !== "development" || row.language !== "asl") fail("reviewed batch must be ASL development");
    if (!review || review.status !== "approved" || !pseudonym(review.reviewer_id)
      || review.reviewer_id === row.participant_id || review.fluent_asl !== true
      || review.independent_of_participant !== true || review.blinded_to_predictions !== true
      || !text(review.variant_notes) || !/^\d{4}-\d{2}-\d{2}$/.test(review.reviewed_on ?? "")
      || !Number.isFinite(Date.parse(review.reviewed_on))) fail("independent fluent review is incomplete");
    if (!pseudonym(row.consent_reference) || !pseudonym(row.recording_group)
      || !["Left", "Right"].includes(row.dominant_hand) || !text(row.device)
      || row.original_unmodified_take !== true || !Array.isArray(row.physical_hands)
      || !row.physical_hands.length || row.physical_hands.some(hand => !["Left", "Right"].includes(hand))) fail("capture/consent metadata is incomplete");
    if (row.trial_type === "sign" && normalize(review.actual_gloss) !== normalize(row.expected_gloss)) fail("reviewed sign differs from expected gloss");
    if (row.trial_type === "no_sign" && (review.actual_gloss !== null || review.activity_confirmed !== true
      || !text(row.negative_activity))) fail("no-sign activity is not confirmed");
    if (row.trial_type === "unknown_sign" && (!normalize(review.actual_gloss)
      || normalize(review.actual_gloss) !== normalize(row.oov_gloss) || !vocabulary
      || row.vocabulary_sha256 !== vocabulary.sha256
      || vocabulary.words.includes(normalize(row.oov_gloss)))) fail("unknown sign is missing or supported by the installed vocabulary");
  }
  return rows;
}

export function validateNewDevelopmentParticipants(rows, related) {
  const reserved = new Set(related.flat().filter(row => row.evaluation_split === "held_out").map(row => signerKey(row.participant_id)));
  const groups = new Set(related.flat().map(row => row.recording_group ?? row.archive_member ?? row.recording_sha256));
  for (const row of rows) {
    if (reserved.has(signerKey(row.participant_id))) throw new Error("Reserved holdout participant cannot enter development collection");
    if (groups.has(row.recording_group)) throw new Error("Source recording group already belongs to a frozen cohort");
  }
}

export function approveDevelopmentIntake(intake, plan, vocabulary) {
  const template = makeDevelopmentIntake(plan);
  if (intake.plan_id !== plan.plan_id || intake.trials?.length !== template.trials.length) throw new Error("Intake must contain every planned trial");
  if (!Array.isArray(intake.participants) || intake.participants.length !== plan.participant_ids.length
    || new Set(intake.participants.map(p => p.participant_id)).size !== plan.participant_ids.length
    || intake.participants.some(p => !plan.participant_ids.includes(p.participant_id) || !["Left", "Right"].includes(p.dominant_hand)))
    throw new Error("Declare every participant's actual dominant hand");
  if (plan.require_both_dominant_hands && new Set(intake.participants.map(p => p.dominant_hand)).size !== 2)
    throw new Error("Recruit both left- and right-dominant participants");
  const byId = new Map(intake.trials.map(row => [row.trial_id, row]));
  if (byId.size !== template.trials.length) throw new Error("Duplicate or missing planned trial");
  const oovSlots = new Map(), rows = template.trials.map(expected => {
    const row = byId.get(expected.trial_id);
    if (!row) throw new Error(`Missing planned trial ${expected.trial_id}`);
    for (const key of ["participant_id", "language", "evaluation_split", "trial_type", "expected_gloss", "collection_slot", "take"])
      if (row[key] !== expected[key]) throw new Error(`${expected.trial_id}: planned ${key} changed`);
    if (!text(row.source) || !text(row.license)) throw new Error(`${row.trial_id}: source/consent license is missing`);
    const participant = intake.participants.find(p => p.participant_id === row.participant_id);
    if (plan.participant_ids.includes(row.review?.reviewer_id)) throw new Error("Reviewer must be independent of the collection participants");
    const result = { trial_id: row.trial_id, participant_id: row.participant_id, language: "asl",
      trial_type: row.trial_type, expected_gloss: row.expected_gloss, evaluation_split: "development",
      file: row.file, source: row.source, license: row.license, consent_reference: row.consent_reference,
      recording_group: row.recording_group, dominant_hand: participant.dominant_hand,
      physical_hands: row.physical_hands, device: row.device, original_unmodified_take: row.original_unmodified_take,
      collection_slot: row.collection_slot, take: row.take, independent_review: row.review,
      annotation_review: `independent fluent review: ${row.review?.reviewer_id}`,
      ...(row.trial_type === "no_sign" ? { negative_activity: expected.instruction } : {}),
      ...(row.trial_type === "unknown_sign" ? { oov_gloss: row.review?.actual_gloss, vocabulary_sha256: vocabulary.sha256 } : {}),
    };
    if (row.trial_type === "unknown_sign") {
      const label = normalize(result.oov_gloss), previous = oovSlots.get(row.collection_slot);
      if (previous && previous !== label) throw new Error("OOV slot must identify the same gloss across takes and participants");
      oovSlots.set(row.collection_slot, label);
    }
    return result;
  });
  validateReviewedDevelopmentRows(rows, vocabulary);
  if (new Set(oovSlots.values()).size !== plan.unknown_sign_slots) throw new Error("OOV slots must identify distinct unsupported glosses");
  return rows;
}
