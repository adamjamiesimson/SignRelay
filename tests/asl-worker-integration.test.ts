import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VisionFrame, WorkerInput, WorkerMessage } from "../lib/vision-types";
import { makeSign } from "./fixtures/asl-motion";

const mocks = vi.hoisted(() => ({ model: vi.fn() }));
vi.mock("../lib/asl1000-runtime", () => ({ recognizeAsl1000: mocks.model }));
let worker: { onmessage: (event: { data: WorkerInput }) => Promise<void>; postMessage: ReturnType<typeof vi.fn> };
const confirmations = () => worker.postMessage.mock.calls.map(([m]) => m as WorkerMessage).filter(m => m.type === "confirmed");
async function feed(frames: VisionFrame[]) {
  for (const frame of frames) {
    await worker.onmessage({ data: { type: "frame", frame } });
    await Promise.resolve();
  }
}
beforeEach(async () => {
  vi.resetModules();
  mocks.model.mockReset().mockResolvedValue(null);
  worker = { onmessage: async () => {}, postMessage: vi.fn() };
  vi.stubGlobal("self", worker);
  await import("../workers/recognition.worker");
});

describe("ASL worker with real temporal and confirmation code (synthetic input)", () => {
  it.each(["HELLO", "NO", "YES", "PLEASE", "SORRY", "THANK YOU"] as const)("confirms %s once without another label", async sign => {
    await feed(makeSign(sign));
    expect(confirmations().map(result => result.gloss)).toEqual([sign]);
  });
  it("recognizes successive different signs after consuming the first movement", async () => {
    await feed(makeSign("NO"));
    await feed(makeSign("HELLO").map(frame => ({ ...frame, timestamp: frame.timestamp + 950 })));
    expect(confirmations().map(result => result.gloss)).toEqual(["NO", "HELLO"]);
  });
  it("does not repeatedly speak a held I LOVE YOU", async () => {
    const held = makeSign("IDLE", { duration: 8000, count: 161 });
    for (const frame of held) { frame.hands[0].gesture = "ILoveYou"; frame.hands[0].gestureScore = 0.95; }
    await feed(held);
    expect(confirmations().map(result => result.gloss)).toEqual(["I LOVE YOU"]);
    await feed(makeSign("IDLE", { duration: 700, count: 15 }).map(frame => ({ ...frame, hands: [], timestamp: frame.timestamp + 8050 })));
    await feed(held.slice(0, 20).map(frame => ({ ...frame, timestamp: frame.timestamp + 8800 })));
    expect(confirmations()).toHaveLength(2);
  });
  it("keeps a closed-set model from turning idle hands into a word", async () => {
    mocks.model.mockResolvedValue({ label: "BOOK", text: "Book", confidence: 0.99, margin: 0.9 });
    await feed(makeSign("IDLE", { duration: 6000, count: 121, jitter: 0.002 }));
    expect(mocks.model).not.toHaveBeenCalled();
    expect(confirmations()).toHaveLength(0);
  });
  it("passes a short completed non-starter movement to the research model and confirms two fresh results", async () => {
    mocks.model.mockResolvedValue({ label: "BOOK", text: "Book", confidence: 0.94, margin: 0.5 });
    const frames = makeSign("IDLE", { duration: 1600, count: 33 });
    frames.forEach((frame, index) => frame.hands[0].landmarks.forEach(point => {
      point.y += 0.3;
      point.x += Math.min(1, index / 10) * 0.12;
    }));
    await feed(frames);
    expect(mocks.model.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(confirmations().map(result => result.gloss)).toEqual(["BOOK"]);
    expect(mocks.model.mock.calls[0][0].length).toBeLessThan(24);
  });
  it("recovers after lost tracking without replaying an old sign", async () => {
    await feed(makeSign("HELLO").slice(0, 4));
    await feed(makeSign("IDLE").map(frame => ({ ...frame, timestamp: frame.timestamp + 200, hands: [] })));
    expect(confirmations()).toHaveLength(0);
    await feed(makeSign("NO").map(frame => ({ ...frame, timestamp: frame.timestamp + 1150 })));
    expect(confirmations().map(result => result.gloss)).toEqual(["NO"]);
  });
  it("confirms two slow model results while still processing camera frames", async () => {
    vi.useFakeTimers();
    try {
      mocks.model.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve({
        label: "BOOK", text: "Book", confidence: 0.94, margin: 0.5,
      }), 700)));
      const frames = makeSign("IDLE", { duration: 4000, count: 81 });
      frames.forEach((frame, index) => frame.hands[0].landmarks.forEach(point => {
        point.y += 0.3;
        point.x += Math.min(1, index / 12) * 0.12;
      }));
      for (const frame of frames) {
        await worker.onmessage({ data: { type: "frame", frame } });
        await vi.advanceTimersByTimeAsync(50);
      }
      expect(confirmations().map(result => result.gloss)).toEqual(["BOOK"]);
      expect(mocks.model).toHaveBeenCalledTimes(2);
      expect(worker.postMessage.mock.calls.filter(([message]) => message.type === "analysis")).toHaveLength(81);
    } finally {
      vi.useRealTimers();
    }
  });
  it("keeps recognizing successive signs throughout a long session", async () => {
    const signs = ["NO", "HELLO", "YES", "PLEASE", "SORRY", "THANK YOU"] as const;
    const expected: string[] = [];
    for (let repetition = 0; repetition < 60; repetition++) {
      const sign = signs[repetition % signs.length];
      expected.push(sign);
      await feed(makeSign(sign).map(frame => ({ ...frame, timestamp: frame.timestamp + repetition * 1600 })));
    }
    expect(confirmations().map(result => result.gloss)).toEqual(expected);
  });
});
