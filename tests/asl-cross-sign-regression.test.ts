import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VisionFrame, WorkerInput, WorkerMessage } from "../lib/vision-types";
import { makeSign, type Sign } from "./fixtures/asl-motion";

// Cross-sign regression on synthetic kinematics: every change to a rule must
// keep each core word confirmed exactly once with no other label, across
// capture conditions. It is a regression net, not a measure of accuracy.
const mocks = vi.hoisted(() => ({ model: vi.fn() }));
vi.mock("../lib/asl1000-runtime", () => ({ recognizeAsl1000: mocks.model }));
let worker: { onmessage: (event: { data: WorkerInput }) => Promise<void>; postMessage: ReturnType<typeof vi.fn> };
beforeEach(async () => {
  vi.resetModules();
  mocks.model.mockReset().mockResolvedValue(null);
  worker = { onmessage: async () => {}, postMessage: vi.fn() };
  vi.stubGlobal("self", worker);
  await import("../workers/recognition.worker");
});
const SIGNS = ["HELLO", "NO", "YES", "PLEASE", "SORRY", "THANK YOU"] as const satisfies readonly Sign[];
const settle = (frames: VisionFrame[]) => {
  const last = frames.at(-1)!;
  return [...frames, ...Array.from({ length: 8 }, (_, i) => ({ ...structuredClone(last), timestamp: last.timestamp + (i + 1) * 50 }))];
};
const CONDITIONS: Record<string, (sign: Sign) => VisionFrame[]> = {
  "10 fps": sign => makeSign(sign, { count: 10 }),
  "15 fps": sign => makeSign(sign, { count: 14 }),
  "30 fps": sign => makeSign(sign, { count: 28 }),
  "fast (600 ms)": sign => makeSign(sign, { duration: 600, count: 14 }),
  "slow (1.6 s)": sign => makeSign(sign, { duration: 1600, count: 36 }),
  "left hand": sign => makeSign(sign, { side: "Left" }),
  "farther from camera": sign => makeSign(sign, { scale: 0.7 }),
  "closer to camera": sign => makeSign(sign, { scale: 1.3 }),
  "landmark jitter": sign => makeSign(sign, { jitter: 0.004 }),
  "every 5th hand frame lost": sign => makeSign(sign).map((frame, i) => i % 5 === 2 ? { ...frame, hands: [] } : frame),
  "every 3rd hand frame lost": sign => makeSign(sign).map((frame, i) => i % 3 === 1 ? { ...frame, hands: [] } : frame),
  "two-frame mid-sign dropout": sign => makeSign(sign).map((frame, i) => i === 10 || i === 11 ? { ...frame, hands: [] } : frame),
  "no pose": sign => makeSign(sign).map(frame => ({ ...frame, pose: [] })),
  "no face": sign => makeSign(sign).map(frame => ({ ...frame, face: [] })),
  "unknown handedness": sign => makeSign(sign).map(frame => ({ ...frame, hands: frame.hands.map(hand => ({ ...hand, handedness: "Unknown" as const })) })),
};
const cases = Object.entries(CONDITIONS).flatMap(([condition, make]) => SIGNS.map(sign => [condition, sign, make] as const));

describe("core ASL words across capture conditions", () => {
  it.each(cases)("%s: %s confirms exactly once with no other label", async (_condition, sign, make) => {
    for (const frame of settle(make(sign))) { await worker.onmessage({ data: { type: "frame", frame } }); await Promise.resolve(); }
    const words = worker.postMessage.mock.calls.map(([m]) => m as WorkerMessage).filter(m => m.type === "confirmed").map(m => (m as { gloss: string }).gloss);
    expect(words).toEqual([sign]);
  });
  it.each(["HELLO", "THANK YOU"] as const)("abstains on %s without any head reference (no face and no pose)", async sign => {
    for (const frame of settle(makeSign(sign).map(f => ({ ...f, face: [], pose: [] })))) {
      await worker.onmessage({ data: { type: "frame", frame } }); await Promise.resolve();
    }
    expect(worker.postMessage.mock.calls.filter(([m]) => m.type === "confirmed")).toEqual([]);
  });
});
