import { afterAll, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import plan from "../docs/evaluation/development-collection-plan-2026-10-17.json";
import { aslVocabulary, fingerprint } from "../scripts/evaluation-manifest.mjs";
import { canonicalLock, loadFrozenCohorts } from "../scripts/evaluation-cohorts.mjs";
import { approveDevelopmentIntake, makeDevelopmentIntake, validateNewDevelopmentParticipants,
  validateReviewedDevelopmentRows } from "../scripts/reviewed-development.mjs";

const vocabulary = aslVocabulary();
const temporaryDirectories: string[] = [];
afterAll(async () => { for (const directory of temporaryDirectories) await rm(directory, { recursive: true, force: true }); });
// Metadata-only constructed controls. No signer or real review is fabricated.
function approvedControl() {
  const intake = makeDevelopmentIntake(plan);
  intake.participants.forEach((p: { dominant_hand: string | null }, i: number) => { p.dominant_hand = i % 2 ? "Left" : "Right"; });
  intake.trials.forEach(row => {
    Object.assign(row, { source: "unit-test-only", license: "unit-test-only", consent_reference: "unit-consent",
      recording_group: row.trial_id, physical_hands: ["Right"], device: "unit-test-only", original_unmodified_take: true });
    Object.assign(row.review, { status: "approved", reviewer_id: "unit-reviewer", fluent_asl: true,
      independent_of_participant: true, blinded_to_predictions: true,
      actual_gloss: row.trial_type === "sign" ? row.expected_gloss : row.trial_type === "unknown_sign" ? `UNITTESTONLY${row.collection_slot}` : null,
      activity_confirmed: true, variant_notes: "constructed validation control", reviewed_on: "2026-10-17" });
  });
  return intake;
}

describe("reviewed development collection preflight", () => {
  it("creates 144 pending slots without pretending any recording or review exists", () => {
    const intake = makeDevelopmentIntake(plan);
    expect(intake.trials).toHaveLength(144);
    expect(intake.trials.filter(row => row.trial_type === "sign")).toHaveLength(72);
    expect(intake.trials.filter(row => row.trial_type === "no_sign")).toHaveLength(48);
    expect(intake.trials.filter(row => row.trial_type === "unknown_sign")).toHaveLength(24);
    expect(new Set(intake.trials.map(row => row.trial_id)).size).toBe(144);
    expect(intake.trials.every(row => row.review.status === "pending" && row.source === null)).toBe(true);
    expect(() => approveDevelopmentIntake(intake, plan, vocabulary)).toThrow();
  });
  it("accepts complete review metadata and verifies the installed unknown-sign vocabulary", () => {
    const rows = approveDevelopmentIntake(approvedControl(), plan, vocabulary);
    expect(rows).toHaveLength(144);
    expect(rows.filter(row => row.trial_type === "unknown_sign").every(row => row.vocabulary_sha256 === vocabulary.sha256)).toBe(true);
    expect(rows.every(row => row.evaluation_split === "development")).toBe(true);
  });
  it("rejects incomplete, duplicated or relabelled planned trials", () => {
    const missing = approvedControl(); missing.trials.pop();
    expect(() => approveDevelopmentIntake(missing, plan, vocabulary)).toThrow("every planned trial");
    const duplicate = approvedControl(); duplicate.trials[1] = duplicate.trials[0];
    expect(() => approveDevelopmentIntake(duplicate, plan, vocabulary)).toThrow("Duplicate");
    const relabelled = approvedControl(); relabelled.trials[0].expected_gloss = "PLEASE";
    expect(() => approveDevelopmentIntake(relabelled, plan, vocabulary)).toThrow("planned expected_gloss");
  });
  it.each(["pending", "rejected"])("refuses %s review", status => {
    const intake = approvedControl(); intake.trials[0].review.status = status;
    expect(() => approveDevelopmentIntake(intake, plan, vocabulary)).toThrow("fluent review");
  });
  it("requires a separate fluent reviewer, blinded annotations, consent and actual capture metadata", () => {
    for (const field of ["fluent_asl", "independent_of_participant", "blinded_to_predictions"]) {
      const intake = approvedControl(); intake.trials[0].review[field] = false;
      expect(() => approveDevelopmentIntake(intake, plan, vocabulary)).toThrow("fluent review");
    }
    const selfReview = approvedControl(); selfReview.trials[0].review.reviewer_id = plan.participant_ids[1];
    expect(() => approveDevelopmentIntake(selfReview, plan, vocabulary)).toThrow("independent");
    const noConsent = approvedControl(); noConsent.trials[0].consent_reference = null;
    expect(() => approveDevelopmentIntake(noConsent, plan, vocabulary)).toThrow("capture/consent");
  });
  it("rejects a wrong gloss, an unconfirmed ordinary activity, or supported/OOV aliases", () => {
    const wrong = approvedControl(); wrong.trials[0].review.actual_gloss = "PLEASE";
    expect(() => approveDevelopmentIntake(wrong, plan, vocabulary)).toThrow("differs");
    const ordinary = approvedControl(); ordinary.trials.find(row => row.trial_type === "no_sign").review.activity_confirmed = false;
    expect(() => approveDevelopmentIntake(ordinary, plan, vocabulary)).toThrow("not confirmed");
    const supported = approvedControl(); supported.trials.filter(row => row.trial_type === "unknown_sign").forEach(row => { row.review.actual_gloss = "thank_you"; });
    expect(() => approveDevelopmentIntake(supported, plan, vocabulary)).toThrow("supported");
    const rows = approveDevelopmentIntake(approvedControl(), plan, vocabulary);
    rows.find(row => row.trial_type === "unknown_sign")!.vocabulary_sha256 = "changed";
    expect(() => validateReviewedDevelopmentRows(rows, vocabulary)).toThrow("vocabulary");
  });
  it("requires actual left/right dominant participants and distinct unknown glosses", () => {
    const rightOnly = approvedControl(); rightOnly.participants.forEach((p: { dominant_hand: string | null }) => { p.dominant_hand = "Right"; });
    expect(() => approveDevelopmentIntake(rightOnly, plan, vocabulary)).toThrow("both left");
    const sameOov = approvedControl(); sameOov.trials.filter(row => row.trial_type === "unknown_sign").forEach(row => { row.review.actual_gloss = "UNITTESTONLY"; });
    expect(() => approveDevelopmentIntake(sameOov, plan, vocabulary)).toThrow("distinct");
  });
  it("rejects reserved signer aliases and reused recording groups before opening media", () => {
    expect(() => validateNewDevelopmentParticipants([{ participant_id: "gtsignstudy4a.99", recording_group: "new" }],
      [[{ participant_id: "popsign-4a.99", evaluation_split: "held_out", recording_group: "sealed" }]])).toThrow("Reserved");
    expect(() => validateNewDevelopmentParticipants([{ participant_id: "new", recording_group: "same" }],
      [[{ participant_id: "old", evaluation_split: "development", recording_group: "same" }]])).toThrow("recording group");
  });
  it("loads the existing cohorts unchanged and rejects a replacement lock that drops or rewrites them", async () => {
    const original = await readFile(canonicalLock);
    const { registry, cohorts } = await loadFrozenCohorts(undefined, vocabulary);
    expect(cohorts.map(cohort => cohort.rows.length)).toEqual([6, 5, 5]);
    const dir = await mkdtemp(join(tmpdir(), "signrelay-cohort-control-"));
    temporaryDirectories.push(dir);
    const file = join(dir, "lock.json");
    await writeFile(file, JSON.stringify({ ...registry, manifests: registry.manifests.slice(0, 2) }));
    await expect(loadFrozenCohorts(file, vocabulary)).rejects.toThrow("preserve every original");
    await writeFile(file, JSON.stringify({ ...registry, manifests: registry.manifests.map((m: { sha256: string }, i: number) => i ? m : { ...m, sha256: "f".repeat(64) }) }));
    await expect(loadFrozenCohorts(file, vocabulary)).rejects.toThrow("preserve every original");
    expect(fingerprint(await readFile(canonicalLock))).toBe(fingerprint(original));
  });
});
