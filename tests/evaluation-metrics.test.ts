import { describe, expect, it } from "vitest";
import { summarizeTrials, validateTrials } from "../scripts/evaluation-metrics.mjs";
import { diagnoseHandedness } from "../lib/handedness-diagnostic";
import { makeSign } from "./fixtures/asl-motion";
const trial = { session_id: "s", participant_id: "p", language: "asl", trial_type: "sign",
  expected_gloss: "HELLO", predicted_gloss: "HELLO", accepted: true, evaluation_split: "held_out" };
describe("accuracy evidence counts failures instead of hiding them", () => {
  it("counts an extra wrong word as a wrong accepted trial", () => {
    const [summary] = summarizeTrials([{ ...trial, accepted_glosses: ["HELLO", "PLEASE"] }]);
    expect(summary.correct).toBe(0); expect(summary.wrong_accepted_trials).toBe(1);
    expect(summary.confusions).toEqual({ "HELLO → PLEASE": 1 });
  });
  it("reports correct signs, abstentions and both negative-trial false acceptance rates", () => {
    const [summary] = summarizeTrials([trial, { ...trial, accepted: false, predicted_gloss: null },
      { ...trial, trial_type: "no_sign", expected_gloss: null },
      { ...trial, trial_type: "unknown_sign", expected_gloss: null, predicted_gloss: null, accepted: false }]);
    expect(summary.signed_accuracy).toBe(0.5); expect(summary.abstentions).toBe(1);
    expect(summary.no_sign.rate).toBe(1); expect(summary.unknown_sign.rate).toBe(0);
  });
  it("does not count runtime failures as successful recognition or invent negative evidence", () => {
    const [summary] = summarizeTrials([{ ...trial, status: "error" }]);
    expect(summary.correct).toBe(0); expect(summary.errors).toBe(1);
    expect(summary.no_sign.rate).toBeNull(); expect(summary.holdout_verified).toBe(false);
  });
  it.each(["no_sign", "unknown_sign"] as const)("does not report failed %s trials as successful rejections", trial_type => {
    const negative = { ...trial, trial_type, expected_gloss: null, predicted_gloss: null, accepted: false };
    const [failed] = summarizeTrials([{ ...negative, status: "error" }]);
    expect(failed[trial_type]).toMatchObject({ trials: 1, completed_trials: 0, errors: 1, false_accepts: 0, rate: null });
    const [partial] = summarizeTrials([negative, { ...negative, status: "error", predicted_gloss: "PLEASE", accepted: true }]);
    expect(partial[trial_type]).toMatchObject({ trials: 2, completed_trials: 1, errors: 1, false_accepts: 1, rate: null });
  });
  it("treats recorded runtime errors as failures even if status was accidentally omitted", () => {
    const [summary] = summarizeTrials([{ ...trial, errors: ["Model could not load"] }]);
    expect(summary.correct).toBe(0); expect(summary.errors).toBe(1);
  });
  it("rejects inconsistent outputs, duplicate recordings and contaminated splits", () => {
    expect(() => validateTrials([{ ...trial, accepted_glosses: [] }])).toThrow("disagrees");
    expect(() => validateTrials([{ ...trial, trial_type: "no_sign" }])).toThrow("negative");
    expect(() => validateTrials([trial, { ...trial, evaluation_split: "development" }])).toThrow("participant");
    expect(() => validateTrials([1, 2].map(() => ({ ...trial, recording_sha256: "a".repeat(64) })))).toThrow("duplicate recording");
  });
  it("separates development measurements from declared held-out measurements", () => {
    expect(summarizeTrials([trial, { ...trial, participant_id: "dev", evaluation_split: "development" }])).toHaveLength(2);
  });
});
describe("handedness diagnostic preserves Tasks labels", () => {
  it("compares a human-labelled hand without changing model slots", () => {
    const frame = makeSign("HELLO")[0]; frame.pose[16] = frame.hands[0].landmarks[0]; frame.pose[15] = { x: 0, y: 0, z: 0 };
    const before = JSON.stringify(frame);
    expect(diagnoseHandedness(frame, "Right")[0]).toMatchObject({ taskLabel: "Right", agreesWithHuman: true,
      nearestPose: "Right", agreesWithPose: true, aslNodes: "34–54", bslNodes: "39–59" });
    expect(JSON.stringify(frame)).toBe(before);
    expect(diagnoseHandedness(frame, "Left")[0].agreesWithHuman).toBe(false);
  });
});
