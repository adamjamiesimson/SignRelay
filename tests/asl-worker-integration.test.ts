import { beforeEach, describe, expect, it, vi } from "vitest";
import { recognizeAslStarter } from "../lib/asl-starter-recognition";
import { prepareCalibrationSequence } from "../lib/personalized-recognition";
import type { VisionFrame, WorkerInput, WorkerMessage } from "../lib/vision-types";
import { makeSign } from "./fixtures/asl-motion";

const mocks = vi.hoisted(() => ({ model: vi.fn() }));
vi.mock("../lib/asl1000-runtime", () => ({ recognizeAsl1000: mocks.model }));

let worker: { onmessage: (event: { data: WorkerInput }) => Promise<void>; postMessage: ReturnType<typeof vi.fn> };
const confirmations = () => worker.postMessage.mock.calls
  .map(([message]) => message as WorkerMessage)
  .filter((message): message is Extract<WorkerMessage, { type: "confirmed" }> => message.type === "confirmed");

async function feed(frames: VisionFrame[]) {
  for (const frame of frames) {
    await worker.onmessage({ data: { type: "frame", frame } });
    await new Promise<void>(resolve => setImmediate(resolve));
  }
}

beforeEach(async () => {
  vi.resetModules();
  mocks.model.mockReset().mockResolvedValue({ label: "BOOK", text: "Book", confidence: 0.99, margin: 0.9 });
  worker = { onmessage: async () => {}, postMessage: vi.fn() };
  vi.stubGlobal("self", worker);
  await import("../workers/recognition.worker");
});

describe("ASL safe mode after external live-domain benchmark failure", () => {
  it.each(["HELLO", "NO", "YES", "PLEASE", "SORRY", "THANK YOU"] as const)(
    "keeps %s geometry testable without automatically inserting it into the transcript", async sign => {
      const frames = makeSign(sign);
      expect(recognizeAslStarter(frames)?.label).toBe(sign);
      await feed(frames);
      expect(confirmations()).toHaveLength(0);
      expect(mocks.model).not.toHaveBeenCalled();
    });

  it("never invokes the dormant WLASL classifier for arbitrary completed ASL movement", async () => {
    const frames = makeSign("IDLE", { duration: 2400, count: 49 });
    frames.forEach((frame, index) => frame.hands[0].landmarks.forEach(point => {
      point.y += 0.3;
      point.x += Math.min(1, index / 15) * 0.12;
    }));
    await feed(frames);
    expect(mocks.model).not.toHaveBeenCalled();
    expect(confirmations()).toHaveLength(0);
  });

  it("does not turn a held canned I LOVE YOU gesture into automatic transcript text", async () => {
    const held = makeSign("IDLE", { duration: 5000, count: 101 });
    for (const frame of held) {
      frame.hands[0].gesture = "ILoveYou";
      frame.hands[0].gestureScore = 0.99;
    }
    await feed(held);
    expect(mocks.model).not.toHaveBeenCalled();
    expect(confirmations()).toHaveLength(0);
  });

  it("preserves explicitly saved personal ASL recognition in safe mode", async () => {
    const recorded = makeSign("HELLO", { duration: 900, count: 21 });
    await worker.onmessage({ data: { type: "templates", language: "asl", templates: [{
      id: "personal-hello",
      language: "asl",
      gloss: "HELLO",
      text: "Hello",
      createdAt: 1,
      frames: prepareCalibrationSequence(recorded),
    }] } });
    await feed(recorded);
    expect(confirmations().map(message => message.gloss)).toEqual(["HELLO"]);
    expect(mocks.model).not.toHaveBeenCalled();
  });

  it("keeps safe mode silent through a long sequence of uncalibrated signs", async () => {
    const signs = ["NO", "HELLO", "YES", "PLEASE", "SORRY", "THANK YOU"] as const;
    for (let repetition = 0; repetition < 30; repetition++) {
      const sign = signs[repetition % signs.length];
      await feed(makeSign(sign).map(frame => ({
        ...frame,
        timestamp: frame.timestamp + repetition * 1800,
      })));
    }
    expect(confirmations()).toHaveLength(0);
    expect(mocks.model).not.toHaveBeenCalled();
  });
});
