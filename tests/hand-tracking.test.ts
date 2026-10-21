import { beforeEach, describe, expect, it, vi } from "vitest";
import { stabilizeHandedness, type SingleHandTrack } from "../lib/hand-tracking";
import type { VisionFrame, WorkerInput, WorkerMessage } from "../lib/vision-types";
import { makeSign } from "./fixtures/asl-motion";

// Synthetic kinematic frames; these test label continuity, not sign accuracy.
const run = (frames: VisionFrame[]) => {
  let track: SingleHandTrack = null;
  return frames.map(frame => { const result = stabilizeHandedness(track, frame); track = result.track; return result.frame; });
};
const switchedAt = (frames: VisionFrame[], index: number) =>
  frames.map((frame, i) => i >= index ? { ...frame, hands: frame.hands.map(hand => ({ ...hand, handedness: "Left" as const })) } : frame);

describe("single-hand label continuity", () => {
  it("keeps one moving hand's label through a sustained MediaPipe label change", () => {
    expect(run(switchedAt(makeSign("YES"), 8)).map(frame => frame.hands[0].handedness)).toEqual(Array(21).fill("Right"));
  });
  it("never edits frames with two hands", () => {
    const frames = makeSign("HELLO").map(frame => ({ ...frame, hands: [frame.hands[0], { ...frame.hands[0], handedness: "Left" as const }] }));
    expect(run(frames)).toEqual(frames);
  });
  it("does not link a hand that reappears after a pause or in another place", () => {
    const frames = makeSign("YES");
    const later = switchedAt(frames, 10).map((frame, i) => i >= 10 ? { ...frame, timestamp: frame.timestamp + 400 } : frame);
    expect(run(later).at(-1)!.hands[0].handedness).toBe("Left");
    const elsewhere = switchedAt(frames, 10).map((frame, i) => i >= 10 ? { ...frame, hands: frame.hands.map(hand => ({ ...hand,
      landmarks: hand.landmarks.map(point => ({ ...point, x: point.x - 0.35 })) })) } : frame);
    expect(run(elsewhere).at(-1)!.hands[0].handedness).toBe("Left");
  });
});

const mocks = vi.hoisted(() => ({ model: vi.fn() }));
vi.mock("../lib/asl1000-runtime", () => ({ recognizeAsl1000: mocks.model }));
let worker: { onmessage: (event: { data: WorkerInput }) => Promise<void>; postMessage: ReturnType<typeof vi.fn> };
const confirmations = () => worker.postMessage.mock.calls.map(([m]) => m as WorkerMessage).filter(m => m.type === "confirmed");
async function feed(frames: VisionFrame[]) {
  for (const frame of frames) { await worker.onmessage({ data: { type: "frame", frame } }); await Promise.resolve(); }
}
const settled = (frames: VisionFrame[]) => {
  const last = frames.at(-1)!;
  return [...frames, ...Array.from({ length: 6 }, (_, i) => ({ ...structuredClone(last), timestamp: last.timestamp + (i + 1) * 45 }))];
};
beforeEach(async () => {
  vi.resetModules();
  mocks.model.mockReset().mockResolvedValue(null);
  worker = { onmessage: async () => {}, postMessage: vi.fn() };
  vi.stubGlobal("self", worker);
  await import("../workers/recognition.worker");
});

describe("ASL worker with a mid-sign handedness label change", () => {
  it.each(["YES", "PLEASE", "SORRY", "HELLO", "NO", "THANK YOU"] as const)("confirms %s once when the label switches halfway", async sign => {
    const frames = makeSign(sign, { count: 31, duration: 1300 });
    await feed(settled(switchedAt(frames, 15)));
    expect(confirmations().map(result => result.gloss)).toEqual([sign]);
  });
  it("does not assemble YES from two different hands in different places", async () => {
    const right = makeSign("YES", { count: 31, duration: 1300 });
    const split = right.map((frame, i) => i < 15 ? frame : { ...frame, hands: frame.hands.map(hand => ({ ...hand, handedness: "Left" as const,
      landmarks: hand.landmarks.map(point => ({ ...point, x: point.x - 0.4 })) })) });
    await feed(settled(split));
    expect(confirmations()).toEqual([]);
  });
  it("still sends the model the unmodified MediaPipe labels", async () => {
    const frames = makeSign("IDLE", { duration: 1600, count: 33 });
    frames.forEach((frame, index) => frame.hands[0].landmarks.forEach(point => { point.y += 0.3; point.x += Math.min(1, index / 10) * 0.12; }));
    await feed(switchedAt(frames, 8));
    expect(mocks.model).toHaveBeenCalled();
    const labels = mocks.model.mock.calls.flatMap(([sequence]) => (sequence as VisionFrame[]).flatMap(frame => frame.hands.map(hand => hand.handedness)));
    expect(labels).toContain("Left");
  });
});
