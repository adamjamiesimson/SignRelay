import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VisionFrame, WorkerAnalysis, WorkerInput, WorkerMessage } from "../lib/vision-types";
import { makeSign } from "./fixtures/asl-motion";

// Synthetic kinematic sequences through the real worker; not accuracy evidence.
const mocks = vi.hoisted(() => ({ model: vi.fn() }));
vi.mock("../lib/asl1000-runtime", () => ({ recognizeAsl1000: mocks.model }));
let worker: { onmessage: (event: { data: WorkerInput }) => Promise<void>; postMessage: ReturnType<typeof vi.fn> };
const messages = () => worker.postMessage.mock.calls.map(([m]) => m as WorkerMessage);
const confirmations = () => messages().filter(m => m.type === "confirmed").map(m => (m as { gloss: string }).gloss);
async function feed(frames: VisionFrame[]) {
  for (const frame of frames) { await worker.onmessage({ data: { type: "frame", frame } }); await Promise.resolve(); }
}
const shift = (frames: VisionFrame[], by: number) => frames.map(frame => ({ ...structuredClone(frame), timestamp: frame.timestamp + by }));
const hold = (frame: VisionFrame, ms: number, step = 50) => Array.from({ length: Math.floor(ms / step) },
  (_, i) => ({ ...structuredClone(frame), timestamp: frame.timestamp + (i + 1) * step }));
const end = (frames: VisionFrame[]) => frames.at(-1)!.timestamp;

beforeEach(async () => {
  vi.resetModules();
  mocks.model.mockReset().mockResolvedValue(null);
  worker = { onmessage: async () => {}, postMessage: vi.fn() };
  vi.stubGlobal("self", worker);
  await import("../workers/recognition.worker");
});

describe("motion segmentation and stale evidence", () => {
  it("emits one word for one movement even while the hand stays still for 8 seconds", async () => {
    mocks.model.mockResolvedValue({ label: "PLEASE", text: "Please", confidence: 0.95, margin: 0.6 });
    const sign = makeSign("PLEASE");
    await feed([...sign, ...hold(sign.at(-1)!, 8000)]);
    expect(confirmations()).toEqual(["PLEASE"]);
  });
  it("does not join two halves of a chest circle separated by lost tracking", async () => {
    const circle = makeSign("PLEASE", { count: 31, duration: 1300 });
    const first = circle.slice(0, 15), second = circle.slice(15);
    const gap = Array.from({ length: 14 }, (_, i) => ({ ...structuredClone(first.at(-1)!), hands: [], timestamp: end(first) + (i + 1) * 50 }));
    await feed([...first, ...gap, ...shift(second, 700)]);
    expect(confirmations()).toEqual([]);
  });
  it("confirms rapid consecutive different signs once each, in order", async () => {
    const order = ["NO", "HELLO", "PLEASE", "YES"] as const;
    let offset = 0;
    for (const sign of order) {
      const frames = shift(makeSign(sign), offset);
      await feed(frames);
      offset = end(frames) - 1000 + 120;
    }
    await feed(hold(shift(makeSign("YES"), offset - 120).at(-1)!, 400));
    expect(confirmations()).toEqual([...order]);
  });
  it("accepts a deliberately repeated word after the cooldown, but not a duplicate inside it", async () => {
    await feed(makeSign("NO"));
    await feed(shift(makeSign("NO"), 1000));
    expect(confirmations()).toEqual(["NO"]);
    await feed(shift(makeSign("NO"), 4000));
    expect(confirmations()).toEqual(["NO", "NO"]);
  });
  it("reports an unfinished movement as in progress, not as a completed no-match", async () => {
    // A sideways sweep that is still moving when the stream ends.
    const partial = makeSign("IDLE", { duration: 1600, count: 33 });
    partial.forEach((frame, index) => frame.hands[0].landmarks.forEach(point => { point.y += 0.3; point.x += index / 32 * 0.2; }));
    await feed(partial.slice(0, 20));
    const last = messages().filter((m): m is WorkerAnalysis => m.type === "analysis").at(-1)!;
    expect(last.motionReason).toBe("moving");
    expect(last.feedback).toContain("Following your movement");
    expect(confirmations()).toEqual([]);
  });
});
