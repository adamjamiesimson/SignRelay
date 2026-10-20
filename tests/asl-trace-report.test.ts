import { describe, expect, it } from "vitest";
import { summarizeAslTrace } from "../scripts/diagnostics/asl-trace-report";
import { makeSign } from "./fixtures/asl-motion";
import type { WorkerAnalysis } from "../lib/vision-types";

function fixture() {
  const frames = makeSign("HELLO", { duration: 300, count: 7 });
  const row = { trial_id: "constructed-control", recording_sha256: "a".repeat(64),
    evaluation_split: "development", frames: 7, analyses: 7, expected_gloss: "HELLO",
    accepted_glosses: [] as string[], status: "complete", errors: [] as string[],
    worker_sha256: "b".repeat(64), source_commit: "c".repeat(40) };
  const trace = { trial_id: row.trial_id, recording_sha256: row.recording_sha256,
    row: { recording_sha256: row.recording_sha256, frames: 7, analyses: 7 },
    events: frames.flatMap(frame => [
      { type: "frame" as const, frame },
      { type: "worker" as const, message: { type: "analysis", state: "uncertain", candidate: null,
        confidence: 0, bufferSize: 7, motionReason: "moving", feedback: "Following movement" } satisfies WorkerAnalysis },
    ]) };
  return { trace, row };
}
describe("aggregate ASL development trace diagnostics", () => {
  it("reports observable counters without returning any recorded coordinates", () => {
    const { trace, row } = fixture(), result = summarizeAslTrace(trace, row);
    expect(result).toMatchObject({ frames: 7, worker_analyses: 7, valid_hand_frames: 7,
      longest_consecutive_hand_frames: 7, first_hand_ms: 0, last_hand_ms: 300,
      starter_tracking_eligible_endpoints: 3, worker_motion_reasons: { moving: 7 } });
    expect(result).toMatchObject({
      hand_continuity: { hand_tracking_episodes: 1, longest_hand_episode_frames: 7,
        leading_missing_hand_frames: 0, trailing_missing_hand_frames: 0 },
      candidate_continuity: { expected_candidate_analyses: 0, competing_candidate_analyses: 0 },
      abstention_triage: { primary_observation: "eligible_without_proposal",
        observed_signals: expect.arrayContaining(["no_worker_motion_ready_analysis"]) },
    });
    expect(JSON.stringify(result)).not.toMatch(/"(?:landmarks|face|pose|hands|x|y|z|events)":/);
  });
  it("distinguishes sparse tracking from a window eligible for classification", () => {
    const { trace, row } = fixture();
    trace.events.forEach(event => { if (event.type === "frame" && event.frame.timestamp !== 1150) event.frame.hands = []; });
    expect(summarizeAslTrace(trace, row)).toMatchObject({ valid_hand_frames: 1,
      longest_consecutive_hand_frames: 1, starter_tracking_eligible_endpoints: 0 });
  });
  it("counts missing-hand intervals without asserting the human stroke was interrupted", () => {
    const { trace, row } = fixture();
    const handFrames = trace.events.filter(event => event.type === "frame");
    handFrames[2].frame.hands = [];
    handFrames[3].frame.hands = [];
    const result = summarizeAslTrace(trace, row);
    expect(result.hand_continuity).toMatchObject({ hand_tracking_episodes: 2,
      interruptions_between_hand_episodes: 1, longest_interior_missing_hand_frames: 2 });
    expect(result.abstention_triage?.observed_signals).toContain("hand_visibility_interrupted");
  });
  it("does not simulate an unconsumed history after a real confirmation", () => {
    const { trace, row } = fixture(); row.accepted_glosses = ["HELLO"];
    expect(summarizeAslTrace(trace, row).abstention_prefix_probe).toBeNull();
    expect(summarizeAslTrace(trace, row).abstention_triage).toBeNull();
  });
  it("rejects holdout traces and mismatched or incomplete evidence", () => {
    const { trace, row } = fixture();
    expect(() => summarizeAslTrace(trace, { ...row, evaluation_split: "held_out" })).toThrow("Only development");
    expect(() => summarizeAslTrace(trace, { ...row, trial_id: "other" })).toThrow("identity");
    expect(() => summarizeAslTrace(trace, { ...row, status: "error" })).toThrow("Incomplete");
    expect(() => summarizeAslTrace(trace, { ...row, analyses: 6 })).toThrow("counters");
  });
  it("rejects duplicate or reversed source timestamps", () => {
    const { trace, row } = fixture();
    const frames = trace.events.filter(event => event.type === "frame");
    frames[1].frame.timestamp = frames[0].frame.timestamp;
    expect(() => summarizeAslTrace(trace, row)).toThrow("Non-monotonic");
  });
});
