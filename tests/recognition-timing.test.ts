import { beforeEach, describe, expect, it, vi } from "vitest";
import { recognizeAslStarter } from "../lib/asl-starter-recognition";
import { analyzeSignMotion } from "../lib/sign-motion";
import { prepareCalibrationSequence } from "../lib/personalized-recognition";
import { makeSign } from "./fixtures/asl-motion";
import type { VisionFrame, WorkerInput, WorkerMessage } from "../lib/vision-types";

const mocks = vi.hoisted(() => ({ model: vi.fn() }));
vi.mock("../lib/asl1000-runtime", () => ({ recognizeAsl1000: mocks.model }));
let worker: { onmessage: (event: { data: WorkerInput }) => Promise<void>; postMessage: ReturnType<typeof vi.fn> };
const confirmations = () => worker.postMessage.mock.calls.map(([message]) => message as WorkerMessage).filter(message => message.type === "confirmed");
async function feed(frames: VisionFrame[]) {
  for (const frame of frames) {
    await worker.onmessage({ data: { type: "frame", frame } });
    // Browser worker messages run on separate event-loop turns, after the
    // previous inference's promise callbacks (including cleanup) have settled.
    await new Promise<void>(resolve => setImmediate(resolve));
  }
}
beforeEach(async () => {
  vi.resetModules();
  mocks.model.mockReset().mockResolvedValue(null);
  worker = { onmessage: async () => {}, postMessage: vi.fn() };
  vi.stubGlobal("self", worker);
  await import("../workers/recognition.worker");
});

describe("recognition with slow and uneven camera delivery", () => {
  it.each(["HELLO", "NO", "YES", "PLEASE", "SORRY", "THANK YOU"] as const)("confirms %s at 3.3 frames per second", async sign => {
    const frames = makeSign(sign, { duration: 2400, count: 9 });
    expect(recognizeAslStarter(frames)?.label).toBe(sign);
    await feed(frames);
    expect(confirmations().map(message => message.gloss)).toEqual([sign]);
  });
  it("admits completed finger movement without requiring a fast camera", () => {
    expect(analyzeSignMotion(makeSign("NO", { duration: 2400, count: 9 })).ready).toBe(true);
  });
  it("runs and confirms fresh research-model results before a slow completion window closes", async () => {
    mocks.model.mockResolvedValue({ label: "BOOK", text: "Book", confidence: 0.94, margin: 0.5 });
    const frames = makeSign("IDLE", { duration: 3000, count: 11 });
    frames.forEach((frame, index) => frame.hands[0].landmarks.forEach(point => {
      point.y += 0.3;
      point.x += Math.min(1, index / 6) * 0.12;
    }));
    await feed(frames);
    expect(mocks.model.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(confirmations().map(message => message.gloss)).toEqual(["BOOK"]);
  });
  it("does not reinterpret slowly delivered idle hands as a sign", async () => {
    mocks.model.mockResolvedValue({ label: "BOOK", text: "Book", confidence: 0.99, margin: 0.9 });
    await feed(makeSign("IDLE", { duration: 6000, count: 21, jitter: 0.002 }));
    expect(mocks.model).not.toHaveBeenCalled();
    expect(confirmations()).toHaveLength(0);
  });
  it.each(["asl", "auslan", "bsl", "csl", "isl", "lse", "uaesl", "vsl"] as const)("confirms saved personal %s signs with slow delivery", async language => {
    const movement = (duration: number, count: number) => makeSign("IDLE", { duration, count }).map((frame, index) => ({
      ...frame, hands: frame.hands.map(hand => ({ ...hand, landmarks: hand.landmarks.map(point => ({
        ...point, y: point.y + 0.3, x: point.x + Math.min(1, index / (count - 1) / 0.75) * 0.12,
      })) })),
    }));
    await worker.onmessage({ data: { type: "templates", language, templates: [{
      id: "personal", language, gloss: "MY WORD", text: "My word", createdAt: 1,
      frames: prepareCalibrationSequence(movement(900, 21)),
    }] } });
    await feed(movement(2400, 9));
    expect(confirmations().map(message => message.gloss)).toEqual(["MY WORD"]);
  });
  it("recovers when one camera delivery is delayed", async () => {
    const frames = makeSign("NO", { duration: 2400, count: 9 });
    frames.forEach((frame, index) => { if (index >= 3) frame.timestamp += 180; });
    await feed(frames);
    expect(confirmations().map(message => message.gloss)).toEqual(["NO"]);
  });
  it("allows fresh movement immediately after a long camera pause", () => {
    const before = makeSign("IDLE");
    const after = makeSign("NO").map(frame => ({ ...frame, timestamp: frame.timestamp + 2600 }));
    expect(analyzeSignMotion([...before, ...after]).ready).toBe(true);
  });
  it("allows fresh movement after a long loss of hand tracking", () => {
    const before = makeSign("IDLE", { duration: 1500, count: 31 }).map(frame => ({ ...frame, hands: [] }));
    const after = makeSign("NO").map(frame => ({ ...frame, timestamp: frame.timestamp + 1550 }));
    expect(analyzeSignMotion([...before, ...after]).ready).toBe(true);
  });
  it("never completes an old sign from samples on opposite sides of a long pause", () => {
    const frames = makeSign("NO", { duration: 2400, count: 9 });
    frames.forEach((frame, index) => { if (index >= 5) frame.timestamp += 1800; });
    expect(recognizeAslStarter(frames)).toBeNull();
    expect(analyzeSignMotion(frames).ready).toBe(false);
  });
});
