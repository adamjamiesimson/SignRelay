import { describe, expect, it } from "vitest";
import {
  summarizeHandContinuity, candidateContinuity, triageAslAbstention,
} from "../scripts/diagnostics/asl-observation-triage.mjs";
import historical from "../docs/evaluation/asl-miss-diagnosis-2026-10-17/historical-trace-report.json";
import additional from "../docs/evaluation/asl-miss-diagnosis-2026-10-17/development-trace-report.json";

const row = (name: string) => [...historical.trials, ...additional.trials].find(r => r.trial_id === name)!;

describe("aggregate tracking continuity, not a signed-stroke annotation", () => {
  it("reports internal hand-visibility gaps separately from leading and trailing empty frames", () => {
    const present = [false, true, true, false, false, true, false];
    const frames = present.map((hand, i) => ({ timestamp: 1000 + i * 50, hand }));
    expect(summarizeHandContinuity(frames, f => f.hand)).toEqual({
      hand_tracking_episodes: 2,
      hand_visible_frames: 3,
      hand_visible_fraction: 3 / 7,
      longest_hand_episode_frames: 2,
      longest_hand_episode_ms: 50,
      interruptions_between_hand_episodes: 1,
      longest_interior_missing_hand_frames: 2,
      leading_missing_hand_frames: 1,
      trailing_missing_hand_frames: 1,
      first_valid_hand_delay_ms: 50,
      last_valid_hand_to_end_ms: 50,
    });
  });
  it("does not make up a hand endpoint when no frames contain valid hands", () => {
    const frames = [0, 50, 100].map(timestamp => ({ timestamp, seen: false }));
    expect(summarizeHandContinuity(frames, f => f.seen)).toMatchObject({
      hand_tracking_episodes: 0, hand_visible_frames: 0,
      first_valid_hand_delay_ms: null, last_valid_hand_to_end_ms: null,
      leading_missing_hand_frames: 3, trailing_missing_hand_frames: 3,
    });
  });
  it("fails on a non-monotonic source timeline", () => {
    expect(() => summarizeHandContinuity([{timestamp: 1}, {timestamp: 1}], () => true)).toThrow("increasing");
  });
  it("counts separate candidate streaks without declaring a confirmation", () => {
    expect(candidateContinuity([
      { candidate: "HELLO" }, { candidate: "HELLO" }, { candidate: null },
      { candidate: "THANK YOU" }, { candidate: "HELLO" },
    ], "HELLO")).toEqual({
      expected_candidate_analyses: 3,
      competing_candidate_analyses: 1,
      longest_consecutive_expected_candidate_analyses: 2,
    });
  });
});

describe("retrospective ASL development abstention triage", () => {
  it("preserves all eleven reused recordings, counting only the six true abstentions", () => {
    const recordings = [...historical.trials, ...additional.trials];
    expect(recordings).toHaveLength(11);
    expect(recordings.filter(r => r.accepted_glosses.length === 0)).toHaveLength(6);
    const outcomes = recordings.map(triageAslAbstention);
    expect(outcomes.filter(Boolean)).toHaveLength(6);
    expect(outcomes.every((result, i) => !recordings[i].accepted_glosses.length || result === null)).toBe(true);
  });
  it("distinguishes the one HELLO proposal from no HELLO proposal", () => {
    const once = triageAslAbstention(row("hello-gtsignstudy4a.8031"))!;
    const none = triageAslAbstention(row("dev-hello-4a.8006"))!;
    expect(once.primary_observation).toBe("unconfirmed_proposal");
    expect(once.observed_signals).toContain("expected_word_proposed_not_confirmed");
    expect(none.primary_observation).toBe("eligible_without_proposal");
    expect(none.observed_signals).toContain("no_worker_motion_ready_analysis");
  });
  it("separates sparse THANK YOU footage from ambiguous competing proposals", () => {
    const sparse = triageAslAbstention(row("thankyou-gtsignstudy4a.8031"))!;
    const ambiguous = triageAslAbstention(row("thankyou-gtsignstudy4a.8033"))!;
    expect(sparse.primary_observation).toBe("sparse_hand_samples");
    expect(sparse.observed_signals).toContain("no_basic_starter_eligible_endpoint");
    expect(ambiguous.primary_observation).toBe("competing_proposals");
    expect(ambiguous.observed_signals).toContain("incomplete_starter_geometry_probe_observed");
    expect(ambiguous.observed_signals).toContain("worker_ambiguity_feedback_observed");
    expect(ambiguous.expected_proposal_analyses).toBe(1);
    expect(ambiguous.other_proposal_analyses).toBe(1);
  });
  it("does not mistake YES tracking scarcity for neural misclassification", () => {
    const yes = triageAslAbstention(row("dev-yes-4a.8006"))!;
    expect(yes.primary_observation).toBe("sparse_hand_samples");
    expect(yes.observed_signals).toContain("fewer_than_six_valid_hand_frames");
    expect(yes.observed_signals).toContain("no_worker_motion_ready_analysis");
  });
  it("does not fabricate continuity on historical aggregate reports that lack episode data", () => {
    const result = triageAslAbstention(row("dev-yes-4a.8006"))!;
    expect(result.observed_signals).not.toContain("hand_visibility_interrupted");
  });
  it("flags actual interrupted hand episodes only when supplied", () => {
    const result = triageAslAbstention({ ...row("dev-yes-4a.8006"),
      hand_continuity: { hand_tracking_episodes: 3 } })!;
    expect(result.observed_signals).toContain("hand_visibility_interrupted");
  });
  it("never outputs frames, coordinates or raw reviewer claims", () => {
    const data = triageAslAbstention(row("thankyou-gtsignstudy4a.8033"));
    expect(JSON.stringify(data)).not.toMatch(/"(landmarks|face|pose|hands|events|x|y|z)":/);
    expect(data?.uncertainty).toMatch(/independent fluent review/);
  });
  it("rejects invalid counters instead of diagnosing a runtime failure as a valid abstention", () => {
    expect(() => triageAslAbstention({ ...row("dev-yes-4a.8006"), frames: 2 })).toThrow("inconsistent");
  });
});
