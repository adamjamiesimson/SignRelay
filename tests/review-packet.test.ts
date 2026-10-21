import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { importCaptures } from "../scripts/capture-intake.mjs";
import { makeReviewPacket, mergeReviews } from "../scripts/review-packet.mjs";
import { makeDevelopmentIntake } from "../scripts/reviewed-development.mjs";
import { captureMetadata, captureTrial, type CaptureType } from "../lib/field-test-capture";

const plan = JSON.parse(readFileSync("docs/evaluation/development-collection-plan-2026-10-17.json", "utf8"));
// Synthetic WebM headers; no person, recording or real review is represented.
function captured(slots: [CaptureType, number, number][]) {
  const captures = slots.map(([type, slot, take], index) => {
    const video = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(40, index + 1)]);
    const sidecar = captureMetadata({ trial: captureTrial(0, type, slot, take), mime: "video/webm", bytes: video.length,
      sha256: createHash("sha256").update(video).digest("hex"), recordedAt: "2026-10-22T09:00:00Z", durationMs: 3000,
      stopReason: "manual", dominantHand: "Right", physicalHands: ["Right"], device: "Laptop / Chrome",
      oovGloss: type === "unknown_sign" ? "GIRAFFE" : null, camera: { width: 640, height: 480, frameRate: 30, facingMode: "user" } });
    return { sidecar, sidecarName: `${sidecar.trial_id}.capture.json`, videoName: sidecar.original_recording_file, video };
  });
  return importCaptures({ plan, intake: makeDevelopmentIntake(plan), captures }).intake;
}
const reviewer = { reviewer_id: "reviewer-a", fluent_asl: true, independent_of_participants: true, blinded_to_predictions: true, reviewed_on: "2026-10-23" };
let counter = 0;
const token = () => (counter++).toString(16).padStart(6, "0");

describe("blind independent review packet", () => {
  it("reveals no trial ID, planned gloss, trial type, participant or prediction to the reviewer", () => {
    const intake = captured([["sign", 1, 1], ["no_sign", 2, 1], ["unknown_sign", 1, 1]]);
    const { packet, key } = makeReviewPacket(intake, token);
    const text = JSON.stringify(packet);
    for (const hidden of ["dev-20261017", "HELLO", "sign-1", "no_sign", "unknown", "GIRAFFE", "prediction\":", "confidence", "expected"])
      expect(text).not.toContain(hidden);
    expect(packet.items).toHaveLength(3);
    expect(packet.items.every((item: { media: string }) => /^R-[0-9a-f]+\.webm$/.test(item.media))).toBe(true);
    expect(key.items.map((item: { trial_id: string }) => item.trial_id).sort()).toEqual(
      ["dev-20261017-p01-no_sign-2-1", "dev-20261017-p01-sign-1-1", "dev-20261017-p01-unknown_sign-1-1"]);
  });
  it("approves only when the reviewer's own label matches the plan and records mismatches as rejected", () => {
    const intake = captured([["sign", 1, 1], ["sign", 2, 1], ["no_sign", 1, 1]]);
    const { packet, key } = makeReviewPacket(intake, token);
    const byTrial = Object.fromEntries(key.items.map((item: { trial_id: string; review_item_id: string }) => [item.trial_id, item.review_item_id]));
    const response = { plan_id: plan.plan_id, reviewer, items: packet.items.map((item: { review_item_id: string }) => {
      if (item.review_item_id === byTrial["dev-20261017-p01-sign-1-1"]) return { ...item, usable: true, actual_sign: "HELLO", variant_notes: "salute from forehead", stroke_start_s: 0.8, stroke_end_s: 1.6 };
      if (item.review_item_id === byTrial["dev-20261017-p01-sign-2-1"]) return { ...item, usable: true, actual_sign: "PLEASE", variant_notes: "flat hand circles chest", stroke_start_s: 0.5, stroke_end_s: 1.9 };
      return { ...item, usable: true, actual_sign: "NO_SIGN", variant_notes: "hands rest on table" };
    }) };
    const { intake: merged, outcome } = mergeReviews({ intake, key, response, participantIds: plan.participant_ids });
    expect(outcome).toEqual({ approved: 2, rejected: 1, unusable: 0, skipped: 0 });
    const trial = (id: string) => merged.trials.find((row: { trial_id: string }) => row.trial_id === id).review;
    expect(trial("dev-20261017-p01-sign-1-1")).toMatchObject({ status: "approved", actual_gloss: "HELLO", stroke_interval: { start_s: 0.8, end_s: 1.6 } });
    expect(trial("dev-20261017-p01-sign-2-1")).toMatchObject({ status: "rejected", decision: "label-differs-from-plan", actual_gloss: "PLEASE" });
    expect(trial("dev-20261017-p01-no_sign-1-1")).toMatchObject({ status: "approved", actual_gloss: null, activity_confirmed: true });
  });
  it.each([
    [{ ...reviewer, fluent_asl: false }, "attest fluent ASL"],
    [{ ...reviewer, blinded_to_predictions: false }, "blindness to predictions"],
    [{ ...reviewer, reviewer_id: "dev-20261017-p02" }, "not a collection participant"],
  ])("refuses responses without independent fluent attestation %#", (header, reason) => {
    const intake = captured([["sign", 1, 1]]);
    const { packet, key } = makeReviewPacket(intake, token);
    expect(() => mergeReviews({ intake, key, participantIds: plan.participant_ids,
      response: { plan_id: plan.plan_id, reviewer: header, items: packet.items } })).toThrow(reason);
  });
  it("requires a stroke interval inside the recording and an unusable reason", () => {
    const intake = captured([["sign", 1, 1]]);
    const { packet, key } = makeReviewPacket(intake, token);
    const merge = (item: object) => mergeReviews({ intake, key, participantIds: plan.participant_ids,
      response: { plan_id: plan.plan_id, reviewer, items: [{ ...packet.items[0], ...item }] } });
    expect(() => merge({ usable: true, actual_sign: "HELLO", variant_notes: "x", stroke_start_s: 1, stroke_end_s: 9 })).toThrow("stroke interval");
    expect(() => merge({ usable: false, actual_sign: null })).toThrow("unusable");
    expect(merge({ usable: false, unusable_reason: "hands leave frame" }).outcome.unusable).toBe(1);
  });
  it("refuses a review of a recording that changed after the packet", () => {
    const intake = captured([["sign", 1, 1]]);
    const { packet, key } = makeReviewPacket(intake, token);
    const changed = structuredClone(intake);
    changed.trials.find((row: { capture?: { sha256: string } }) => row.capture)!.capture.sha256 = "0".repeat(64);
    expect(() => mergeReviews({ intake: changed, key, participantIds: plan.participant_ids, response: { plan_id: plan.plan_id, reviewer,
      items: [{ ...packet.items[0], usable: true, actual_sign: "HELLO", variant_notes: "x", stroke_start_s: 0.2, stroke_end_s: 1 }] } })).toThrow("changed after the packet");
  });
});
