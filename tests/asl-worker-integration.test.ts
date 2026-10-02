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
function quietSeparator(start: number, duration = 300, count = 7) {
  return makeSign("IDLE", { duration, count }).map(frame => ({
    ...frame,
    timestamp: start + frame.timestamp - 1000,
    hands: [],
  }));
}
function shifted(frames: VisionFrame[], start: number) {
  return frames.map(frame => ({ ...frame, timestamp: start + frame.timestamp - 1000 }));
}
async function primeModelFailure() {
  mocks.model.mockReset().mockRejectedValue(new Error("Research model unavailable"));
  const primer = makeSign("IDLE", { duration: 1600, count: 33 });
  primer.forEach((frame, index) => frame.hands[0].landmarks.forEach(point => {
    point.y += 0.3;
    point.x += Math.min(1, index / 10) * 0.12;
  }));
  await feed(primer);
  expect(mocks.model).toHaveBeenCalled();
  expect(confirmations()).toHaveLength(0);
  return primer.at(-1)!.timestamp;
}
beforeEach(async () => {
  vi.resetModules();
  mocks.model.mockReset().mockResolvedValue(null);
  worker = { onmessage: async () => {}, postMessage: vi.fn() };
  vi.stubGlobal("self", worker);
  await import("../workers/recognition.worker");
});

describe("ASL worker with real temporal and confirmation code (synthetic input)", () => {
  it.each(["HELLO", "NO", "YES", "PLEASE", "SORRY", "THANK YOU"] as const)(
    "uses %s rule only after the research model has failed", async sign => {
      const end = await primeModelFailure();
      await feed(shifted(makeSign(sign), end + 900));
      expect(confirmations().map(result => result.gloss)).toEqual([sign]);
    });
  it("does not let starter rules replace a healthy model rejection", async () => {
    mocks.model.mockReset().mockResolvedValue(null);
    await feed(makeSign("HELLO"));
    expect(mocks.model).toHaveBeenCalled();
    expect(confirmations()).toEqual([]);
  });
  it("recognizes successive fallback signs after a real model failure and separator", async () => {
    const end = await primeModelFailure();
    const no = shifted(makeSign("NO"), end + 900);
    await feed(no);
    await feed(quietSeparator(no.at(-1)!.timestamp + 50));
    await feed(shifted(makeSign("HELLO"), no.at(-1)!.timestamp + 500));
    expect(confirmations().map(result => result.gloss)).toEqual(["NO", "HELLO"]);
  });
  it("does not repeatedly speak a held fallback I LOVE YOU", async () => {
    const end = await primeModelFailure();
    const held = shifted(makeSign("IDLE", { duration: 8000, count: 161 }), end + 900);
    for (const frame of held) { frame.hands[0].gesture = "ILoveYou"; frame.hands[0].gestureScore = 0.95; }
    await feed(held);
    expect(confirmations().map(result => result.gloss)).toEqual(["I LOVE YOU"]);
    const afterHeld = held.at(-1)!.timestamp;
    await feed(quietSeparator(afterHeld + 50, 700, 15));
    await feed(shifted(held.slice(0, 20).map(frame => ({ ...frame, timestamp: 1000 + (frame.timestamp - held[0].timestamp) })), afterHeld + 800));
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
  it("fallback recovers after lost tracking without replaying an old sign", async () => {
    const end = await primeModelFailure();
    await feed(shifted(makeSign("HELLO").slice(0, 4), end + 900));
    await feed(quietSeparator(end + 1450, 700, 15));
    expect(confirmations()).toHaveLength(0);
    await feed(shifted(makeSign("NO"), end + 2300));
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
  it("keeps fallback recognition stable through a long model outage", async () => {
    const end = await primeModelFailure();
    const signs = ["NO", "HELLO", "YES", "PLEASE", "SORRY", "THANK YOU"] as const;
    const expected: string[] = [];
    let previousEnd = end;
    for (let repetition = 0; repetition < 24; repetition++) {
      const sign = signs[repetition % signs.length];
      expected.push(sign);
      const start = previousEnd + 500;
      const signFrames = shifted(makeSign(sign), start);
      await feed(quietSeparator(previousEnd + 50));
      await feed(signFrames);
      previousEnd = signFrames.at(-1)!.timestamp;
    }
    expect(confirmations().map(result => result.gloss)).toEqual(expected);
  });
});
