import { describe, expect, it } from "vitest";
import { prepareTgcnInput } from "../lib/asl1000-runtime";
import { assignHands, prepareAsl2000Input } from "../lib/tgcn-input";
import type { HandObservation, Point, VisionFrame } from "../lib/vision-types";

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

const handNodes = (input: Float32Array) => input.slice(13 * 100, 55 * 100);

describe("ASL-2000 input construction", () => {
  it("documents the shipped v1 defect: real Tasks hands (visibility 0) never reached the model", () => {
    const frames = Array.from({ length: 12 }, (_, i) => frame(i * 50, [tasksHand("Right", 0.4, 0.5)]));
    expect(handNodes(prepareTgcnInput(frames)).every(value => value === -1)).toBe(true);
  });

  it("keeps Tasks hand landmarks when visibility is ignored for hands", () => {
    const frames = Array.from({ length: 12 }, (_, i) => ({ ...frame(i * 50, [tasksHand("Right", 0.4, 0.5)]), pose: [] }));
    const input = prepareAsl2000Input(frames);
    const right = input.slice(34 * 100, 55 * 100), left = input.slice(13 * 100, 34 * 100);
    expect(right[0]).toBeCloseTo(2 * (0.4 - 0.5), 6);
    expect(right.every(value => value !== -1)).toBe(true);
    expect(left.every(value => value === -1)).toBe(true);
  });

  it("places a 25 fps grid on actual timestamps and pads the final sample", () => {
    const frames = Array.from({ length: 5 }, (_, i) => ({ ...frame(i * 50, [tasksHand("Right", 0.3 + i * 0.1, 0.5)]), pose: [] }));
    const input = prepareAsl2000Input(frames);
    const wristX = Array.from({ length: 50 }, (_, i) => Math.round(input[34 * 100 + i * 2] * 10));
    expect(wristX.slice(0, 8)).toEqual([-4, -4, -2, 0, 2, 4, 4, 4]);
    expect(wristX.slice(6).every(value => value === 4)).toBe(true);
  });

  it("places a fixed-rate grid independently of the capture rate", () => {
    // A 1.2 s sign occupies 30 of the 50 model frames whether the camera ran at 15 or 30 fps.
    for (const fps of [15, 30]) {
      const frames = Array.from({ length: Math.round(1.2 * fps) + 1 }, (_, i) => frame(i * 1000 / fps, [tasksHand("Right", 0.3 + i * 0.005, 0.5)]));
      const input = prepareAsl2000Input(frames);
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
    const [left, right] = assignHands(frame(0, [near(0.3, "Left"), near(0.7, "Right")], wrists));
    expect(left?.landmarks[0].x).toBeCloseTo(0.7);
    expect(right?.landmarks[0].x).toBeCloseTo(0.3);
    // Single hand near the right wrist.
    expect(assignHands(frame(0, [near(0.31, "Left")], wrists))[1]).toBeDefined();
    // No pose wrists: keep the label.
    const noPose: VisionFrame = { timestamp: 0, hands: [near(0.31, "Left")], face: [], pose: [] };
    expect(assignHands(noPose)[0]).toBeDefined();
  });

  it("keeps a sign on the same model frames however long the signer pauses afterwards (production input)", () => {
    // 1.2 s of movement at 30 fps, then a settled tail of 0.2 s or 2.0 s.
    const sign = (tail: number) => Array.from({ length: Math.round((1.2 + tail) * 30) + 1 }, (_, i) => {
      const t = Math.min(i / 30, 1.2);
      return frame(i * 1000 / 30, [tasksHand("Right", 0.3 + t * 0.2, 0.5 - t * 0.1)],
        { left: { x: 0.7, y: 0.6, z: 0 }, right: { x: 0.3 + t * 0.2, y: 0.5 - t * 0.1, z: 0 } });
    });
    const short = prepareAsl2000Input(sign(0.2)), long = prepareAsl2000Input(sign(2.0));
    // The first 31 model frames (1.2 s at 25 fps) carry the movement identically.
    for (let node = 0; node < 55; node++) {
      expect([...long.slice(node * 100, node * 100 + 62)]).toEqual([...short.slice(node * 100, node * 100 + 62)]);
    }
  });
});
