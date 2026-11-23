import { beforeEach, describe, expect, it, vi } from "vitest";
import { ASL_DEMO_WORDS } from "../lib/capability-status";
import type { VisionFrame, WorkerInput, WorkerMessage } from "../lib/vision-types";
import { makeSign } from "./fixtures/asl-motion";

// The scripted GITEX sequence through the real worker on synthetic kinematics.
// It proves ordering, gaps and reset behaviour, not that people will be recognized.
const mocks = vi.hoisted(() => ({ model: vi.fn() }));
vi.mock("../lib/asl1000-runtime", () => ({ recognizeAsl1000: mocks.model }));
let worker: { onmessage: (event: { data: WorkerInput }) => Promise<void>; postMessage: ReturnType<typeof vi.fn> };
const words = () => worker.postMessage.mock.calls.map(([m]) => m as WorkerMessage).filter(m => m.type === "confirmed").map(m => (m as { gloss: string }).gloss);
async function feed(frames: VisionFrame[]) {
  for (const frame of frames) { await worker.onmessage({ data: { type: "frame", frame } }); await Promise.resolve(); }
}
/** Hands lowered out of view between signs, as the demo script asks. */
function rest(after: VisionFrame, ms: number) {
  return Array.from({ length: Math.round(ms / 50) }, (_, i) => ({ ...structuredClone(after), hands: [], timestamp: after.timestamp + (i + 1) * 50 }));
}
function sequence(gapMs: number, signs: readonly string[] = ASL_DEMO_WORDS) {
  const frames: VisionFrame[] = [];
  let start = 0;
  for (const sign of signs) {
    const take = makeSign(sign as Parameters<typeof makeSign>[0]).map(frame => ({ ...frame, timestamp: frame.timestamp + start }));
    frames.push(...take, ...rest(take.at(-1)!, gapMs));
    start = frames.at(-1)!.timestamp - 1000 + 50;
  }
  return frames;
}
beforeEach(async () => {
  vi.resetModules();
  mocks.model.mockReset().mockResolvedValue(null);
  worker = { onmessage: async () => {}, postMessage: vi.fn() };
  vi.stubGlobal("self", worker);
  await import("../workers/recognition.worker");
});

describe("scripted six-word demo sequence", () => {
  it.each([400, 700, 1500])("keeps all six words in order with %i ms rests between signs", async gap => {
    await feed(sequence(gap));
    expect(words()).toEqual([...ASL_DEMO_WORDS]);
  });
  it("repeats the whole sequence twice without duplicates or carry-over", async () => {
    await feed(sequence(700, [...ASL_DEMO_WORDS, ...ASL_DEMO_WORDS]));
    expect(words()).toEqual([...ASL_DEMO_WORDS, ...ASL_DEMO_WORDS]);
  });
  it("drops a half-finished sign when the camera is paused and resumed", async () => {
    const all = sequence(700, ["HELLO", "PLEASE", "NO"]);
    const pleaseStart = all.findIndex((frame, i) => i > 0 && frame.hands.length && !all[i - 1].hands.length);
    await feed(all.slice(0, pleaseStart + 8));
    await worker.onmessage({ data: { type: "reset" } });
    const resumed = all.slice(pleaseStart + 8);
    await feed(resumed.filter(frame => frame.timestamp > resumed[0].timestamp + 900));
    expect(words()[0]).toBe("HELLO");
    expect(words()).not.toContain("PLEASE");
  });
});
