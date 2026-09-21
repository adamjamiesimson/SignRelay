// Regression coverage for the frame-rate-dependent tail window flagged in
// docs/reliability-audit-2026-09-20.md: analyzeGenericSignMotion (shared by
// BSL/ISL/LSE/PSL) used to look at the last 7 tracked samples regardless of
// how much real time they spanned. At a fast capture rate that could be well
// under 100ms of actual stillness before confirming a sign; at a slow one it
// could demand well over a second. It now looks back a fixed real-time
// window (with a small sample floor for very slow capture) instead.
import { describe, expect, it } from "vitest";
import { analyzeGenericSignMotion } from "../lib/asl100-runtime";
import type { HandObservation, Point, VisionFrame } from "../lib/vision-types";

function hand(x: number, y: number, shape: number): HandObservation {
  const landmarks: Point[] = Array.from({ length: 21 }, () => ({ x, y, z: 0 }));
  landmarks[9] = { x, y: y - 0.12, z: 0 };
  landmarks[5] = { x: x - 0.04, y: y - 0.1, z: 0 };
  landmarks[17] = { x: x + 0.04, y: y - 0.1, z: 0 };
  for (const tip of [4, 8, 12, 16, 20]) landmarks[tip] = { x: x + shape, y: y - 0.15, z: 0 };
  return { landmarks, handedness: "Right", gesture: "None", gestureScore: 0 };
}

function frame(timestamp: number, x: number, shape: number): VisionFrame {
  return { timestamp, hands: [hand(x, 0.5, shape)], face: [], pose: [] };
}

/**
 * 24 synthetic frames at a fixed capture interval: the wrist travels for the
 * first `movingFrames` samples then holds still, and the hand's finger shape
 * switches once, at `shapeChangeIndex`, from 0 to 0.1 (a shapeDistance of
 * ~0.83 against the 0.14 "settled" tolerance - clearly a different shape).
 */
function buildSequence(options: { intervalMs: number; movingFrames: number; shapeChangeIndex: number }): VisionFrame[] {
  const { intervalMs, movingFrames, shapeChangeIndex } = options;
  const frames: VisionFrame[] = [];
  let x = 0;
  for (let index = 0; index < 24; index++) {
    if (index > 0 && index <= movingFrames) x += 0.02;
    frames.push(frame(index * intervalMs, x, index < shapeChangeIndex ? 0 : 0.1));
  }
  return frames;
}

/**
 * 24 synthetic frames where every frame keeps a valid hand (unlike a
 * dropout), but the capture timeline itself jumps by `gapMs` right before
 * `gapIndex` - modelling a stalled/backgrounded capture pipeline that
 * resumes later, the same real-time discontinuity a large `frame.timestamp`
 * jump represents. Wrist position and finger shape are held constant
 * (0.2, 0.1) across the whole sequence, including across the gap, so
 * nothing about the values themselves distinguishes stale from fresh
 * evidence - only the timestamps do.
 */
function buildGapSequence(options: { intervalMs: number; gapIndex: number; gapMs: number }): VisionFrame[] {
  const { intervalMs, gapIndex, gapMs } = options;
  const frames: VisionFrame[] = [];
  let timestamp = 0;
  let x = 0;
  for (let index = 0; index < 24; index++) {
    if (index > 0) timestamp += index === gapIndex ? gapMs : intervalMs;
    if (index > 0 && index <= 10) x += 0.02;
    frames.push(frame(timestamp, x, 0.1));
  }
  return frames;
}

describe("analyzeGenericSignMotion", () => {
  it("rejects a fast-camera sign whose shape only just settled (under the ~230ms floor)", () => {
    // 15ms intervals (~67fps). Shape has only been stable for the last 9
    // samples (120ms) - the old fixed 7-sample tail (~90-105ms here) would
    // have sat entirely inside that stable stretch and wrongly called it
    // ready; the real-time window now looks back far enough to see the
    // still-unsettled samples just before it.
    const sequence = buildSequence({ intervalMs: 15, movingFrames: 10, shapeChangeIndex: 15 });
    expect(analyzeGenericSignMotion(sequence)).toEqual({ ready: false, reason: "moving" });
  });

  it("accepts a fast-camera sign that has genuinely been stable across the window", () => {
    const sequence = buildSequence({ intervalMs: 15, movingFrames: 10, shapeChangeIndex: 0 });
    expect(analyzeGenericSignMotion(sequence)).toEqual({ ready: true, reason: "ready" });
  });

  it("accepts a slow-camera sign using the sample floor instead of demanding over a second of stillness", () => {
    // 200ms intervals (5fps). The shape and position have been constant
    // since frame 10; the old fixed 7-sample tail would have spanned back to
    // frame 17 (1200ms), well past when the hand actually settled at
    // frame 10. The floor-extended window only needs 4 samples (600ms) of
    // genuinely unchanged tracking here, all of them already settled.
    const sequence = buildSequence({ intervalMs: 200, movingFrames: 10, shapeChangeIndex: 0 });
    expect(analyzeGenericSignMotion(sequence)).toEqual({ ready: true, reason: "ready" });
  });

  it("still rejects a slow-camera sign that changed shape too recently for the floor to have seen it settle", () => {
    // Shape changes at frame 21 (only the last 3 samples show it); the
    // floor-extended tail reaches back to frame 20, which still shows the
    // earlier shape, so this is correctly not yet trusted.
    const sequence = buildSequence({ intervalMs: 200, movingFrames: 10, shapeChangeIndex: 21 });
    expect(analyzeGenericSignMotion(sequence)).toEqual({ ready: false, reason: "moving" });
  });

  it("does not reach back across a real tracking gap to pad the sample floor", () => {
    // A 1000ms stall (e.g. a stuck capture pipeline resuming) lands right
    // before frame 21, leaving only 3 genuinely continuous samples (21-23)
    // since the resume - one short of the floor. Position and shape are
    // identical before and after the gap, so nothing except the timestamps
    // themselves marks the pre-gap samples as stale: a fix that reached
    // backward across the gap to make up the floor would wrongly call this
    // ready off only 3 fresh samples.
    const sequence = buildGapSequence({ intervalMs: 33, gapIndex: 21, gapMs: 1000 });
    expect(analyzeGenericSignMotion(sequence)).toEqual({ ready: false, reason: "moving" });
  });

  it("accepts once enough genuinely continuous evidence has accumulated after the same kind of gap", () => {
    // Same 1000ms stall, but one frame earlier, so 4 continuous samples
    // (20-23) exist since the resume - meeting the floor on fresh evidence
    // alone, with no need to look back across the gap at all.
    const sequence = buildGapSequence({ intervalMs: 33, gapIndex: 20, gapMs: 1000 });
    expect(analyzeGenericSignMotion(sequence)).toEqual({ ready: true, reason: "ready" });
  });
});
