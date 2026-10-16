import { describe, expect, it } from "vitest";
import { verifyPilot } from "../scripts/verify-video-pilot.mjs";
import manifest from "../docs/evaluation/popsign-project-holdout-manifest.json";

const rows = () => manifest.map((m, index) => ({
  trial_id: m.trial_id, participant_id: m.participant_id, session_id: `session-${index}`,
  language: "asl", trial_type: "sign", expected_gloss: m.expected_gloss,
  predicted_gloss: null as string | null, accepted: false, accepted_glosses: [] as string[],
  evaluation_split: "development", reviewed_pilot: true, recording_sha256: m.recording_sha256,
  capture_mode: "unique-decoded-source-frames", tasks_version: "0.10.22-rc.20250304",
  input_mirrored: false, preview_mirrored: true, model_mapping: "unchanged",
  source_duration_s: 1.5, status: "complete", errors: [] as string[], worker_sha256: "a".repeat(64),
  frames: 30, hand_frames: 10, analyses: 25,
}));

describe("historical real-video pilot evidence gate", () => {
  it("accepts a complete, fingerprinted paired set without claiming new holdout evidence", () => {
    const report = verifyPilot(manifest, rows(), rows());
    expect(report).toMatchObject({ diagnostic_only: true, new_holdout: false });
    expect(report.candidate[0].signed_trials).toBe(6);
    expect(report.candidate[0].unknown_sign.rate).toBeNull();
    expect(report.candidate[0].no_sign.rate).toBeNull();
    expect(report.candidate[0].per_gloss.map((r: { gloss: string }) => r.gloss))
      .toEqual(["HELLO", "PLEASE", "THANK YOU"]);
  });
  it("rejects silent missing trials, even when every processed clip completed", () => {
    expect(() => verifyPilot(manifest, rows().slice(1), rows())).toThrow("incomplete pilot");
  });
  it("rejects one silent browser/runtime failure instead of treating it as an abstention", () => {
    const failed = rows();
    failed[0].status = "error"; failed[0].errors = ["camera crashed"];
    expect(() => verifyPilot(manifest, failed, rows())).toThrow("failed or partial");
  });
  it("requires the frozen recording fingerprint and correct signer", () => {
    const modified = rows();
    modified[0].recording_sha256 = "f".repeat(64);
    expect(() => verifyPilot(manifest, modified, rows())).toThrow("mismatched");
    const signerChanged = rows();
    signerChanged[0].participant_id = "unseen-new-signer";
    expect(() => verifyPilot(manifest, rows(), signerChanged)).toThrow("mismatched");
  });
  it("allows bounded frame coalescing but rejects missing analysis evidence", () => {
    const observed = rows(); observed[0].analyses = 0;
    expect(() => verifyPilot(manifest, observed, rows())).toThrow("acknowledgements");
    const tooMany = rows(); tooMany[0].analyses = 31;
    expect(() => verifyPilot(manifest, tooMany, rows())).toThrow("acknowledgements");
  });
  it("does not mislabel a reused pilot as a fresh holdout", () => {
    const pretendingHoldout = rows(); pretendingHoldout[0].evaluation_split = "held_out";
    expect(() => verifyPilot(manifest, rows(), pretendingHoldout)).toThrow(/development and held_out|mismatched/);
  });
  it("flags a newly accepted wrong sign even when the total number correct is unchanged", () => {
    const candidate = rows();
    candidate[0].predicted_gloss = "PLEASE";
    candidate[0].accepted_glosses = ["PLEASE"];
    candidate[0].accepted = true;
    expect(() => verifyPilot(manifest, rows(), candidate)).toThrow(/New wrong acceptance.*HELLO.*PLEASE/);
  });
  it("rejects changes in video orientation between paired runs", () => {
    const other = rows(); other[0].input_mirrored = true;
    expect(() => verifyPilot(manifest, rows(), other)).toThrow("input_mirrored");
  });
});
