import { beforeAll, describe, expect, it, vi } from "vitest";
import type { VisionFrame, WorkerInput, WorkerMessage } from "../lib/vision-types";
import { makeSign } from "./fixtures/asl-motion";

// How long ASL-2000 inference may take before the production worker can no
// longer confirm a model-only word. The model is mocked with a controlled
// latency on a controlled clock; the movement is THANK YOU reversed in time,
// which no starter rule names, followed by a still hold and hands lowered.
// Confirmation needs two results with the same label, each arriving while the
// motion gate is still open (hand visible and still, at most 2,500 ms after
// settling). Synthetic kinematics: a scheduling property, not accuracy.
const mocks = vi.hoisted(() => ({ model: vi.fn(), now: 0 }));
vi.mock("../lib/asl1000-runtime", () => ({ recognizeAsl1000: mocks.model }));
let worker: { onmessage: (event: { data: WorkerInput }) => Promise<void>; postMessage: ReturnType<typeof vi.fn> };
const inFlight: { at: number; resolve: (value: unknown) => void }[] = [];
beforeAll(async () => {
  vi.spyOn(performance, "now").mockImplementation(() => mocks.now);
  mocks.model.mockImplementation(() => new Promise(resolve => inFlight.push({ at: mocks.now, resolve })));
  worker = { onmessage: async () => {}, postMessage: vi.fn() };
  vi.stubGlobal("self", worker);
  await import("../workers/recognition.worker");
});

async function replay(latencyMs: number, intervalMs: number, holdMs: number) {
  inFlight.length = 0;
  mocks.model.mockClear();
  worker.postMessage.mockClear();
  await worker.onmessage({ data: { type: "reset" } });
  const forward = makeSign("THANK YOU", { duration: 900, count: Math.round(900 / intervalMs) + 1 });
  const movement = forward.map((frame, index) => ({ ...forward[forward.length - 1 - index], timestamp: 10000 + frame.timestamp }));
  const last = movement.at(-1)!;
  const frames: VisionFrame[] = [...movement,
    ...Array.from({ length: Math.round(holdMs / intervalMs) }, (_, i) => ({ ...last, timestamp: last.timestamp + (i + 1) * intervalMs })),
    ...Array.from({ length: Math.round(3000 / intervalMs) }, (_, i) => ({ ...last, hands: [], timestamp: last.timestamp + holdMs + (i + 1) * intervalMs }))];
  let maximumInFlight = 0, modelAnalysesWithoutHands = 0;
  for (const frame of frames) {
    mocks.now = frame.timestamp;
    for (const call of inFlight.splice(0)) {
      if (mocks.now - call.at >= latencyMs) call.resolve({ label: "BOOK", text: "Book", confidence: 0.9, margin: 0.5 });
      else inFlight.push(call);
    }
    for (let i = 0; i < 4; i++) await Promise.resolve();
    const before = worker.postMessage.mock.calls.length;
    await worker.onmessage({ data: { type: "frame", frame } });
    maximumInFlight = Math.max(maximumInFlight, inFlight.length);
    const posted = worker.postMessage.mock.calls.slice(before).map(([message]) => message as WorkerMessage);
    if (!frame.hands.length) modelAnalysesWithoutHands += posted.filter(m => m.type === "analysis" && m.source === "model").length;
  }
  const words = worker.postMessage.mock.calls.map(([message]) => message as WorkerMessage)
    .flatMap(message => message.type === "confirmed" ? [message.gloss] : []);
  return { words, maximumInFlight, modelAnalysesWithoutHands };
}

describe("ASL-2000 latency envelope in the production worker", () => {
  it("confirms a model-only word when two results fit inside the motion gate", async () => {
    for (const interval of [66, 100, 200]) for (const latency of [150, 400, 600]) {
      expect((await replay(latency, interval, 2000)).words, `${latency} ms at ${interval} ms/frame`).toEqual(["BOOK"]);
    }
  });

  it("documents the cost: at 900 ms or slower a 2 s hold is too short, and 2.1 s never confirms", async () => {
    // 2,116 ms was the warm median measured on the integration laptop.
    for (const interval of [66, 100, 200]) {
      for (const latency of [900, 1200, 1500, 2100, 2900]) {
        expect((await replay(latency, interval, 2000)).words, `${latency} ms, 2 s hold`).toEqual([]);
      }
      for (const latency of [2100, 2900]) {
        expect((await replay(latency, interval, 3000)).words, `${latency} ms, 3 s hold`).toEqual([]);
      }
    }
  });

  it("never runs inferences concurrently, never revives a result after the hands lower and never repeats", async () => {
    for (const interval of [66, 100, 200]) for (const hold of [500, 1000, 2000, 3000]) {
      for (const latency of [150, 600, 1200, 2100, 2900]) {
        const result = await replay(latency, interval, hold);
        expect(result.maximumInFlight).toBeLessThanOrEqual(1);
        expect(result.modelAnalysesWithoutHands).toBe(0);
        expect(result.words.length).toBeLessThanOrEqual(1);
      }
    }
  });
});
