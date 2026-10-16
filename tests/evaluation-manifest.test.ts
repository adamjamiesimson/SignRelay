import { describe, it, expect } from "vitest";
import { validateManifest, aslVocabulary } from "../scripts/evaluation-manifest.mjs";
const row = { trial_id: "a", participant_id: "popsign-4a.1", language: "asl", trial_type: "sign",
  expected_gloss: "HELLO", evaluation_split: "development", file: "evaluation/videos/a.mp4",
  recording_sha256: "a".repeat(64), source: "https://example.test/licensed", license: "consent-record-a" };
describe("frozen video manifest preflight", () => {
  it("validates before replay and rejects byte duplicates and re-encoded recording groups", () => {
    expect(validateManifest([row])).toEqual([row]);
    expect(() => validateManifest([row, { ...row, trial_id: "b" }])).toThrow("duplicate");
    expect(() => validateManifest([{ ...row, recording_group: "session" }, { ...row,
      trial_id: "b", recording_sha256: "b".repeat(64), recording_group: "session" }])).toThrow("recording group");
  });
  it("detects publisher signer aliases across manifests and languages", () => {
    const held = { ...row, trial_id: "h", participant_id: "gtsignstudy4a.1", language: "bsl",
      recording_sha256: "b".repeat(64), evaluation_split: "held_out" };
    expect(() => validateManifest([row], { related: [[held]] })).toThrow("signer leakage");
  });
  it("refuses to replay a holdout while tuning", () => {
    expect(() => validateManifest([{ ...row, evaluation_split: "held_out" }])).toThrow("Holdout is sealed");
  });
  it("requires reviewed actual activities rather than treating missing footage as a negative", () => {
    expect(() => validateManifest([{ ...row, trial_type: "no_sign", expected_gloss: null }])).toThrow("real activity");
    expect(() => validateManifest([{ ...row, recording_sha256: null }])).toThrow("fingerprint");
  });
  it("checks OOV labels against the actual installed model and starters, including aliases", () => {
    const vocabulary = aslVocabulary();
    const negative = { ...row, trial_type: "unknown_sign", expected_gloss: null,
      oov_gloss: "thank_you", annotation_review: "reviewer-1", vocabulary_sha256: vocabulary.sha256 };
    expect(() => validateManifest([negative], { vocabulary })).toThrow("supported");
    expect(() => validateManifest([{ ...negative, vocabulary_sha256: "changed" }], { vocabulary })).toThrow("snapshot changed");
  });
  it("rejects traversal and invalid negative labels", () => {
    expect(() => validateManifest([{ ...row, file: "evaluation/videos/../a.mp4" }])).toThrow("ignored");
    expect(() => validateManifest([{ ...row, trial_type: "no_sign" }])).toThrow("expected gloss");
  });
});
