import { describe, expect, it } from "vitest";
import { validHand } from "../lib/asl-starter-recognition";
import { summarizeTrackerBehavior } from "../scripts/diagnostics/asl-observation-triage.mjs";
import { makeSign } from "./fixtures/asl-motion";

// Synthetic tracker streams; not recordings or recognition accuracy.
const stream = (mask: string, label: (index: number) => "Left" | "Right" = () => "Right") => {
  const base = makeSign("HELLO", { count: mask.length, duration: (mask.length - 1) * 50 });
  return base.map((frame, index) => ({ ...frame, hands: mask[index] === "x" ? [{ ...frame.hands[0], handedness: label(index) }]
    : mask[index] === "2" ? [frame.hands[0], { ...frame.hands[0], handedness: "Left" as const }] : [] }));
};

describe("tracker behaviour counters", () => {
  it("measures acquisition, disappearance and reacquisition separately from sign boundaries", () => {
    const summary = summarizeTrackerBehavior(stream("..xxxx.xxx....xxxx.."), validHand);
    expect(summary).toMatchObject({ hand_reacquisitions: 2, frames_with_one_hand: 11, frames_with_two_hands: 0,
      interior_missing_runs_by_frames: { "1": 1, "2-3": 0, "4-7": 1, "8+": 0 },
      reacquisition_delay_ms: { min: 100, median: 250, max: 250 }, source_frame_interval_ms: { median: 50, max: 50 } });
    expect(summary.tracked_temporal_coverage).toBeCloseTo((150 + 100 + 150) / 950, 3);
    expect(summary.note).toContain("Tracker observations only");
  });
  it("distinguishes one-frame label flicker from a sustained switch on a single visible hand", () => {
    const flicker = summarizeTrackerBehavior(stream("xxxxxxxxxx", index => index === 4 ? "Left" : "Right"), validHand);
    expect([flicker.single_hand_label_flickers, flicker.single_hand_label_sustained_switches]).toEqual([1, 0]);
    const sustained = summarizeTrackerBehavior(stream("xxxxxxxxxx", index => index >= 5 ? "Left" : "Right"), validHand);
    expect([sustained.single_hand_label_flickers, sustained.single_hand_label_sustained_switches]).toEqual([0, 1]);
  });
  it("does not judge label continuity across two-hand frames", () => {
    const summary = summarizeTrackerBehavior(stream("xx22xx", index => index >= 4 ? "Left" : "Right"), validHand);
    expect(summary.frames_with_two_hands).toBe(2);
    expect(summary.single_hand_label_sustained_switches).toBe(0);
  });
  it("rejects non-monotonic timestamps", () => {
    const frames = stream("xxx");
    frames[2].timestamp = frames[1].timestamp;
    expect(() => summarizeTrackerBehavior(frames, validHand)).toThrow("increasing");
  });
});
