import { describe, expect, it } from "vitest";
import { failedEvaluationTrial } from "../scripts/evaluation-failed-trial.mjs";
import { summarizeTrials } from "../scripts/evaluation-metrics.mjs";
const fixture = { trial_id: "negative-control", participant_id: "unit-person", language: "asl",
  trial_type: "no_sign", expected_gloss: null as string | null, recording_sha256: "a".repeat(64) };
const partial = { ...fixture, session_id: "unit-session", evaluation_split: "development",
  capture_mode: "unique-decoded-source-frames", frames: 23, hand_frames: 8, analyses: 22,
  accepted: true, predicted_gloss: "PLEASE", accepted_glosses: ["PLEASE"],
  status: "error", errors: ["frame timeout"] };
describe("failed video evaluations preserve observed evidence", () => {
  it("keeps partial counters and a false acceptance without declaring a successful negative", () => {
    const row = failedEvaluationTrial(fixture, "development", partial, "frame timeout");
    expect(row).toMatchObject({ frames: 23, hand_frames: 8, analyses: 22, accepted_glosses: ["PLEASE"], status: "error" });
    const [report] = summarizeTrials([row]);
    expect(report.no_sign).toMatchObject({ trials: 1, false_accepts: 1, errors: 1, completed_trials: 0, rate: null });
  });
  it("keeps every extra word and never credits a failed signed trial as correct", () => {
    const signed = { ...fixture, trial_type: "sign", expected_gloss: "HELLO" };
    const row = failedEvaluationTrial(signed, "development", { ...partial, ...signed,
      accepted_glosses: ["HELLO", "PLEASE"], predicted_gloss: "HELLO" }, "decoder stopped");
    expect(row.accepted_glosses).toEqual(["HELLO", "PLEASE"]);
    expect(summarizeTrials([row])[0]).toMatchObject({ correct: 0, wrong_accepted_trials: 1, signed_errors: 1 });
  });
  it.each(["recording_sha256", "evaluation_split", "participant_id"])("does not borrow counters or confirmations with a different %s", key => {
    const row = failedEvaluationTrial(fixture, "development", { ...partial, [key]: "different" }, "startup failure");
    expect(row).toMatchObject({ frames: null, hand_frames: null, analyses: null, accepted_glosses: [], status: "error" });
    expect(summarizeTrials([row])[0].no_sign.rate).toBeNull();
  });
  it("represents unavailable counters as unknown and retains the failed-trial denominator", () => {
    const row = failedEvaluationTrial(fixture, "development", null, new Error("page lost"));
    expect(row.frames).toBeNull();
    expect(summarizeTrials([row])[0].no_sign).toMatchObject({ trials: 1, completed_trials: 0, rate: null });
  });
  it("rejects malformed observations rather than silently converting them to abstentions", () => {
    expect(() => failedEvaluationTrial(fixture, "development", { ...partial, accepted: false }, "failure")).toThrow("disagrees");
    expect(() => failedEvaluationTrial(fixture, "development", { ...partial, analyses: 24 }, "failure")).toThrow("counters");
  });
});
