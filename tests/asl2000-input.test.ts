import { describe, expect, it } from "vitest";
import { ASL2000_INPUT, prepareTgcnInput } from "../lib/asl1000-runtime";
import {
  assignHands, fixedRateIndices, kCopiesIndices, PRODUCTION_V1_INPUT, prepareTgcnWindows, type TgcnInputOptions,
} from "../lib/tgcn-input";
import type { HandObservation, Point, VisionFrame } from "../lib/vision-types";
import { makeSign } from "./fixtures/asl-motion";

// MediaPipe Tasks JS builds every hand landmark as {x, y, z, visibility: field4 ?? 0};
// the hand model never sets field 4. Observed on @mediapipe/tasks-vision 0.10.35
// with Google's own thumb_up/pointing_up/victory test images (Sprint 8 report).
const tasksHand = (handedness: HandObservation["handedness"], x: number, y: number): HandObservation => ({
  handedness, gesture: "None", gestureScore: 0,
  landmarks: Array.from({ length: 21 }, (_, i) => ({ x: x + (i % 5) * 0.01, y: y - Math.floor(i / 5) * 0.02, z: 0, visibility: 0 })),
});

function frame(timestamp: number, hands: HandObservation[], wrists?: { left: Point; right: Point }): VisionFrame {
  const pose: Point[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.6, z: 0, visibility: 0.9 }));
  pose[11] = { x: 0.6, y: 0.5, z: 0, visibility: 0.9 }; // signer-left shoulder (image right, unmirrored)
  pose[12] = { x: 0.4, y: 0.5, z: 0, visibility: 0.9 };
  if (wrists) { pose[15] = { ...wrists.left, visibility: 0.9 }; pose[16] = { ...wrists.right, visibility: 0.9 }; }
  return { timestamp, hands, face: [], pose };
}

const LIVE: TgcnInputOptions = { temporal: { mode: "publisher", fps: 25, copies: 4 }, hands: "label", fillGapMs: 0, framing: null, handVisibility: "ignore" };
const handNodes = (input: Float32Array) => input.slice(13 * 100, 55 * 100);

describe("ASL-2000 input construction", () => {
  it("documents the shipped v1 defect: real Tasks hands (visibility 0) never reached the model", () => {
    const frames = Array.from({ length: 12 }, (_, i) => frame(i * 50, [tasksHand("Right", 0.4, 0.5)]));
    expect(handNodes(prepareTgcnInput(frames)).every(value => value === -1)).toBe(true);
    expect([...handNodes(prepareTgcnWindows(frames, PRODUCTION_V1_INPUT)[0])]).toEqual([...handNodes(prepareTgcnInput(frames))]);
  });

  it("keeps Tasks hand landmarks when visibility is ignored for hands", () => {
    const frames = Array.from({ length: 12 }, (_, i) => frame(i * 50, [tasksHand("Right", 0.4, 0.5)]));
    const [input] = prepareTgcnWindows(frames, LIVE);
    const right = input.slice(34 * 100, 55 * 100), left = input.slice(13 * 100, 34 * 100);
    expect(right[0]).toBeCloseTo(2 * (0.4 - 0.5), 6);
    expect(right.every(value => value !== -1)).toBe(true);
    expect(left.every(value => value === -1)).toBe(true);
  });

  it("matches production prepareTgcnInput bit for bit with the v1 options on synthetic signs", () => {
    for (const gloss of ["HELLO", "THANK YOU", "PLEASE"] as const) {
      const frames = makeSign(gloss);
      expect([...prepareTgcnWindows(frames, PRODUCTION_V1_INPUT)[0]]).toEqual([...prepareTgcnInput(frames)]);
    }
  });

  it("reproduces the publisher's k_copies window starts (code/TGCN/sign_dataset.py)", () => {
    // Golden starts from the publisher's own function, frame_start = 0.
    const publisher: Record<number, number[]> = { 1: [0, 0, 0, 0], 7: [0, 0, 0, 0], 50: [0, 0, 0, 0], 51: [0, 0, 0, 0],
      120: [0, 23, 46, 69], 199: [0, 49, 98, 147], 200: [0, 50, 100, 150], 201: [0, 50, 100, 150], 333: [66, 116, 166, 216] };
    for (const [count, starts] of Object.entries(publisher)) {
      const windows = kCopiesIndices(Number(count), 50, 4);
      expect(windows.map(window => window[0])).toEqual([...new Set(starts)]);
      for (const window of windows) {
        expect(window).toHaveLength(50);
        expect(window.every((value, i) => i === 0 || value - window[i - 1] === 1 || value === Number(count) - 1)).toBe(true);
      }
    }
    // A short clip is padded with its last frame, never stretched.
    expect(kCopiesIndices(7, 50, 4)[0].slice(5, 9)).toEqual([5, 6, 6, 6]);
  });

  it("places a fixed-rate grid on real timestamps with sample-and-hold, independent of capture rate", () => {
    expect(fixedRateIndices([0, 50, 100, 150, 200], 25)).toEqual([0, 0, 1, 2, 3, 4]);
    expect(fixedRateIndices([0, 40, 80], 25)).toEqual([0, 1, 2]);
    // A 1.2 s sign occupies 30 of the 50 model frames whether the camera ran at 15 or 30 fps.
    for (const fps of [15, 30]) {
      const frames = Array.from({ length: Math.round(1.2 * fps) + 1 }, (_, i) => frame(i * 1000 / fps, [tasksHand("Right", 0.3 + i * 0.005, 0.5)]));
      const [input] = prepareTgcnWindows(frames, LIVE);
      const wristX = Array.from({ length: 50 }, (_, f) => input[34 * 100 + f * 2]);
      const moving = wristX.findIndex((value, f) => f > 0 && value === wristX[f - 1] && wristX.slice(f).every(v => v === value));
      expect(moving).toBeGreaterThanOrEqual(30);
      expect(moving).toBeLessThanOrEqual(32);
    }
  });

  it("assigns hands to the nearest pose wrist like OpenPose, falling back to the tracker label", () => {
    const wrists = { left: { x: 0.7, y: 0.6, z: 0 }, right: { x: 0.3, y: 0.6, z: 0 } };
    // Tracker labels reversed relative to the body.
    const near = (x: number, label: HandObservation["handedness"]) => tasksHand(label, x, 0.6);
    const [left, right] = assignHands(frame(0, [near(0.3, "Left"), near(0.7, "Right")], wrists), "pose-wrist");
    expect(left?.landmarks[0].x).toBeCloseTo(0.7);
    expect(right?.landmarks[0].x).toBeCloseTo(0.3);
    // Single hand near the right wrist.
    expect(assignHands(frame(0, [near(0.31, "Left")], wrists), "pose-wrist")[1]).toBeDefined();
    // No pose wrists: keep the label.
    const noPose: VisionFrame = { timestamp: 0, hands: [near(0.31, "Left")], face: [], pose: [] };
    expect(assignHands(noPose, "pose-wrist")[0]).toBeDefined();
  });

  it("keeps a sign on the same model frames however long the signer pauses afterwards (production input)", () => {
    // 1.2 s of movement at 30 fps, then a settled tail of 0.2 s or 2.0 s.
    const sign = (tail: number) => Array.from({ length: Math.round((1.2 + tail) * 30) + 1 }, (_, i) => {
      const t = Math.min(i / 30, 1.2);
      return frame(i * 1000 / 30, [tasksHand("Right", 0.3 + t * 0.2, 0.5 - t * 0.1)],
        { left: { x: 0.7, y: 0.6, z: 0 }, right: { x: 0.3 + t * 0.2, y: 0.5 - t * 0.1, z: 0 } });
    });
    const window = (frames: VisionFrame[], options = ASL2000_INPUT) => prepareTgcnWindows(frames, options)[0];
    const short = window(sign(0.2)), long = window(sign(2.0));
    // The first 31 model frames (1.2 s at 25 fps) carry the movement identically.
    for (let node = 0; node < 55; node++) {
      expect([...long.slice(node * 100, node * 100 + 62)]).toEqual([...short.slice(node * 100, node * 100 + 62)]);
    }
    // The v1 stretch moved the same movement to different model frames.
    const stretched = (frames: VisionFrame[]) => prepareTgcnWindows(frames, { ...PRODUCTION_V1_INPUT, handVisibility: "ignore" })[0];
    expect([...stretched(sign(2.0)).slice(34 * 100, 34 * 100 + 62)]).not.toEqual([...stretched(sign(0.2)).slice(34 * 100, 34 * 100 + 62)]);
  });
});
