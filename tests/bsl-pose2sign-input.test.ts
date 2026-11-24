import { describe, expect, it } from "vitest";
import { assignHandSlots, BSL_FRAMES, BSL_LANDMARKS, buildBslWindows, frameKeypoints, packWindow, resampleBslTimeline,
  selectSignSpan, windowStarts } from "../lib/bsl-pose2sign-input";
import type { HandObservation, Point, VisionFrame } from "../lib/vision-types";

// Synthetic geometry checks the input *contract* (ordering, slots, timing).
// It says nothing about recognition accuracy.

const point = (x: number, y: number, visibility = 0.99): Point => ({ x, y, z: 0, visibility });

function pose(leftWrist = point(0.66, 0.62), rightWrist = point(0.34, 0.62)): Point[] {
  const values = Array.from({ length: 33 }, () => point(0.5, 0.5));
  values[0] = point(0.5, 0.2); values[2] = point(0.53, 0.18); values[5] = point(0.47, 0.18);
  values[7] = point(0.56, 0.2); values[8] = point(0.44, 0.2);
  values[11] = point(0.62, 0.38); values[12] = point(0.38, 0.38); // signer's left shoulder is on image right (unmirrored)
  values[13] = point(0.68, 0.52); values[14] = point(0.32, 0.52);
  values[15] = leftWrist; values[16] = rightWrist;
  // Lower body below the frame: MediaPipe extrapolates it with low visibility.
  values[23] = point(0.58, 0.95, 0.7); values[24] = point(0.42, 0.95, 0.7);
  values[25] = point(0.58, 1.4, 0.1); values[26] = point(0.42, 1.4, 0.1);
  values[27] = point(0.58, 1.8, 0.02); values[28] = point(0.42, 1.8, 0.02);
  return values;
}

function hand(wrist: Point, handedness: HandObservation["handedness"]): HandObservation {
  return { handedness, gesture: "None", gestureScore: 0,
    landmarks: Array.from({ length: 21 }, (_, k) => ({ x: wrist.x + k * 0.002, y: wrist.y - k * 0.003, z: 0 })) };
}

function frame(timestamp: number, hands: HandObservation[], body = pose()): VisionFrame {
  return { timestamp, hands, face: [], pose: body };
}

describe("BSL-1K Pose2Sign input contract", () => {
  it("orders COCO-18 body points as OpenPose did, with an interpolated neck", () => {
    const { values } = frameKeypoints(frame(0, []));
    const xy = (index: number) => [values[index * 3], values[index * 3 + 1]];
    expect(xy(0)).toEqual([0.5, 0.2].map(Math.fround));                  // nose
    expect(xy(1)[0]).toBeCloseTo(0.5); expect(xy(1)[1]).toBeCloseTo(0.38); // neck = shoulder midpoint
    expect(xy(2)[0]).toBeCloseTo(0.38);                                   // OpenPose 2 = right shoulder = MediaPipe 12
    expect(xy(5)[0]).toBeCloseTo(0.62);                                   // OpenPose 5 = left shoulder = MediaPipe 11
    expect(xy(4)[0]).toBeCloseTo(0.34); expect(xy(7)[0]).toBeCloseTo(0.66); // wrists
    expect(xy(14)[0]).toBeCloseTo(0.47); expect(xy(15)[0]).toBeCloseTo(0.53); // R eye = MP 5, L eye = MP 2
    expect(xy(16)[0]).toBeCloseTo(0.44); expect(xy(17)[0]).toBeCloseTo(0.56); // R ear = MP 8, L ear = MP 7
  });

  it("zeroes joints OpenPose could not have detected (low visibility or outside the image)", () => {
    const { values } = frameKeypoints(frame(0, []));
    for (const openPose of [9, 10, 12, 13]) expect(Array.from(values.slice(openPose * 3, openPose * 3 + 3))).toEqual([0, 0, 0]);
    expect(values[8 * 3 + 2]).toBeCloseTo(0.7); // visible hip kept, with its visibility as confidence
    const legacy = frameKeypoints(frame(0, []), { zeroInvisibleBody: false }).values;
    expect(legacy[10 * 3 + 1]).toBeCloseTo(1.8);
  });

  it("puts each hand in the slot of the body wrist it is attached to, even if Tasks labels it the other way", () => {
    const body = pose();
    const signerRight = hand(body[16], "Left"); // mislabelled
    const slots = assignHandSlots(frame(0, [signerRight], body));
    expect(slots).toMatchObject({ method: "pose-wrist", disagreed: true });
    expect(slots.right).toBe(signerRight.landmarks);
    expect(slots.left).toBeUndefined();
    const { values } = frameKeypoints(frame(0, [signerRight], body));
    expect(values[39 * 3]).toBeCloseTo(body[16].x);
    expect(values[18 * 3 + 2]).toBe(0);
    expect(frameKeypoints(frame(0, [signerRight], body), { hands: "tasks-label" }).values[18 * 3]).toBeCloseTo(body[16].x);
  });

  it("resolves two hands jointly, including crossed hands with swapped labels", () => {
    const body = pose(point(0.36, 0.55), point(0.64, 0.55)); // arms crossed
    const a = hand(point(0.37, 0.55), "Left"), b = hand(point(0.63, 0.55), "Right");
    const slots = assignHandSlots(frame(0, [b, a], body));
    expect(slots.left).toBe(a.landmarks);
    expect(slots.right).toBe(b.landmarks);
  });

  it("keeps the Tasks label when the body cannot settle which wrist a lone hand belongs to", () => {
    const body = pose(point(0.52, 0.6), point(0.48, 0.6)); // both wrists together at the centre
    const lone = hand(point(0.5, 0.6), "Right");
    expect(assignHandSlots(frame(0, [lone], body))).toMatchObject({ method: "tasks-label", disagreed: false });
    expect(assignHandSlots(frame(0, [lone], []))).toMatchObject({ method: "tasks-label" });
  });

  it("resamples observations to 25 fps and interpolates held body pose instead of stair-stepping it", () => {
    const sequence: VisionFrame[] = [];
    for (let i = 0; i < 21; i++) {
      // Body pose refreshes every third frame (as VisionEngine's auxiliary cadence does).
      const step = Math.floor(i / 3) * 3;
      const body = pose(point(0.66, 0.62 - step * 0.01), point(0.34, 0.62));
      sequence.push(frame(i * 50, [hand(point(0.66, 0.62 - i * 0.01), "Left")], body));
    }
    const timeline = resampleBslTimeline(sequence);
    expect(timeline.frames).toHaveLength(Math.floor(1000 / 40) + 1);
    const wristY = timeline.frames.map(values => values[7 * 3 + 1]);
    const steps = wristY.slice(1).map((value, index) => wristY[index] - value);
    // Interpolated between refreshes: no long flat runs followed by jumps.
    expect(Math.max(...steps)).toBeLessThan(0.02);
    const handY = timeline.frames.map(values => values[18 * 3 + 1]);
    // The hand moves 0.01 per 50 ms observation. 240 ms lies between the 200 and 250 ms observations.
    expect(handY[5]).toBeCloseTo(0.58, 4);
    expect(handY[6]).toBeCloseTo(0.572, 4);
  });

  it("never invents a hand across a tracking gap", () => {
    const sequence = [frame(0, [hand(point(0.66, 0.6), "Left")]), frame(400, []), frame(800, [hand(point(0.66, 0.6), "Left")])];
    const timeline = resampleBslTimeline(sequence);
    const present = timeline.frames.map(values => values[18 * 3 + 2] > 0);
    expect(present[0]).toBe(true);
    expect(present[10]).toBe(false); // 400 ms
    expect(present.at(-1)).toBe(true);
  });

  it("selects the movement, not the rest pose after it", () => {
    const frames: Float32Array[] = Array.from({ length: 60 }, (_, index) => {
      const values = new Float32Array(BSL_LANDMARKS * 3);
      values[2 * 3] = 0.38; values[5 * 3] = 0.62; // shoulders
      const moving = index >= 10 && index < 30;
      values[18 * 3] = 0.6 + (moving ? (index - 10) * 0.01 : index >= 30 ? 0.2 : 0);
      values[18 * 3 + 1] = 0.5; values[18 * 3 + 2] = 1;
      return values;
    });
    const span = selectSignSpan(frames)!;
    expect(span.start).toBeGreaterThanOrEqual(8);
    expect(span.start).toBeLessThanOrEqual(12);
    expect(span.end).toBeGreaterThanOrEqual(28);
    expect(span.end).toBeLessThanOrEqual(32);
    const starts = windowStarts(frames.length, span);
    // Stride-8 windows covering the span, as BSL-1K's sliding evaluation did.
    expect(starts[0]).toBeLessThanOrEqual(span.start);
    expect(starts.at(-1)! + BSL_FRAMES).toBeGreaterThanOrEqual(span.end);
    starts.slice(1).forEach((start, index) => expect(start - starts[index]).toBeLessThanOrEqual(8));
    expect(starts.every(start => start + BSL_FRAMES <= 30 + 2 + 1 + 8)).toBe(true);
  });

  it("centres one window on a short sign and clamps it to the buffer", () => {
    expect(windowStarts(40, { start: 20, end: 25, peak: 1 })).toEqual([15]);
    expect(windowStarts(40, { start: 35, end: 39, peak: 1 })).toEqual([24]);
    expect(windowStarts(10, { start: 2, end: 5, peak: 1 })).toEqual([]);
  });

  it("packs windows channel-major like _get_pose(...).permute(2, 0, 1)", () => {
    const frames = Array.from({ length: BSL_FRAMES + 3 }, (_, t) => Float32Array.from({ length: BSL_LANDMARKS * 3 },
      (_, i) => t * 1000 + Math.floor(i / 3) + (i % 3) / 10));
    const packed = packWindow(frames, 3);
    for (const [c, t, k] of [[0, 0, 0], [1, 5, 18], [2, 15, 59], [0, 9, 39]]) {
      expect(packed[c * BSL_FRAMES * BSL_LANDMARKS + t * BSL_LANDMARKS + k]).toBeCloseTo((t + 3) * 1000 + k + c / 10, 2);
    }
  });

  it("builds model windows from a realistic VisionFrame stream", () => {
    const sequence = Array.from({ length: 50 }, (_, i) => {
      const x = 0.66 + (i > 10 && i < 30 ? (i - 10) * 0.006 : i >= 30 ? 0.12 : 0);
      return frame(i * 50, [hand(point(x, 0.55), "Right")], pose(point(x, 0.55)));
    });
    const result = buildBslWindows(sequence);
    expect(result.windows.length).toBeGreaterThan(0);
    expect(result.windows.every(window => window.length === 3 * BSL_FRAMES * BSL_LANDMARKS)).toBe(true);
    // Hand at the signer's left wrist goes to the left-hand slot despite its "Right" label.
    expect(result.timeline.slotDisagreements).toBeGreaterThan(40);
  });
});
