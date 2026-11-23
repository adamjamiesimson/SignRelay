import { beforeEach, describe, expect, it, vi } from "vitest";
import { analyzeSignMotion, DEPARTURE_MIN_ABSENT_MS } from "../lib/sign-motion";
import type { VisionFrame, WorkerInput, WorkerMessage } from "../lib/vision-types";
import { makeSign } from "./fixtures/asl-motion";
import { NEGATIVE_CONTROLS } from "./fixtures/asl-negative-controls";

// A movement can end by the hand leaving the view. On the eleven development
// clips tracking ended with the movement, so the research model never received
// a segment. Synthetic kinematics through the real gate and worker: these show
// what the gate does, not how often real signs are recognised.
const mocks = vi.hoisted(() => ({ model: vi.fn() }));
vi.mock("../lib/asl1000-runtime", () => ({ recognizeAsl1000: mocks.model }));
let worker: { onmessage: (event: { data: WorkerInput }) => Promise<void>; postMessage: ReturnType<typeof vi.fn> };
const messages = () => worker.postMessage.mock.calls.map(([m]) => m as WorkerMessage);
const confirmed = () => messages().flatMap(m => m.type === "confirmed" ? [m.gloss] : []);
const modelCandidates = () => messages().flatMap(m => m.type === "analysis" && m.source === "model" && m.candidate ? [m.candidate] : []);
async function feed(frames: VisionFrame[]) {
  for (const frame of frames) { await worker.onmessage({ data: { type: "frame", frame } }); await Promise.resolve(); }
}
/** The hand is gone: frames keep arriving with no hand. */
const away = (after: VisionFrame, ms: number, step = 50) => Array.from({ length: Math.round(ms / step) },
  (_, i) => ({ ...structuredClone(after), hands: [], timestamp: after.timestamp + (i + 1) * step }));
/** A hand that travels sideways across the chest until its last frame: real movement, no starter rule, no rest. */
function reach(count = 14, step = 50) {
  const frames = makeSign("IDLE", { duration: (count - 1) * step, count });
  frames.forEach((frame, index) => frame.hands[0].landmarks.forEach(point => { point.y += 0.3; point.x += index / (count - 1) * 0.16; }));
  return frames;
}
const book = { label: "BOOK", text: "Book", confidence: 0.94, margin: 0.5 };

beforeEach(async () => {
  vi.resetModules();
  mocks.model.mockReset().mockResolvedValue(null);
  worker = { onmessage: async () => {}, postMessage: vi.fn() };
  vi.stubGlobal("self", worker);
  await import("../workers/recognition.worker");
});

describe("movement gate: completion by leaving the view", () => {
  it("is ready once a moving hand has been gone long enough, and returns only observed frames", () => {
    const moving = reach();
    const frames = [...moving, ...away(moving.at(-1)!, 300)];
    const motion = analyzeSignMotion(frames);
    expect(motion).toMatchObject({ ready: true, reason: "ready", completion: "departure" });
    expect(motion.sequence.length).toBeGreaterThanOrEqual(6);
    expect(motion.sequence.every(frame => frame.hands.length === 1)).toBe(true);
    expect(motion.sequence.at(-1)!.timestamp).toBe(moving.at(-1)!.timestamp);
  });
  it("does not read one or two missed frames as leaving", () => {
    const moving = reach();
    for (const ms of [50, 100, 200]) {
      expect(ms).toBeLessThan(DEPARTURE_MIN_ABSENT_MS);
      expect(analyzeSignMotion([...moving, ...away(moving.at(-1)!, ms)])).toMatchObject({ ready: false, reason: "hands" });
    }
    expect(analyzeSignMotion([...moving, ...away(moving.at(-1)!, 300, 300)]).ready).toBe(false);
  });
  it("needs real movement before the hand left: a still hand leaving is not a sign", () => {
    const still = makeSign("IDLE", { duration: 900, count: 19 });
    expect(analyzeSignMotion([...still, ...away(still.at(-1)!, 400)])).toMatchObject({ ready: false, reason: "hands" });
  });
  it("needs enough observations: a hand glimpsed for a few frames is not a sign", () => {
    const glimpse = reach().slice(0, 5);
    expect(analyzeSignMotion([...glimpse, ...away(glimpse.at(-1)!, 400)]).ready).toBe(false);
  });
  it("does not keep a departed movement forever", () => {
    const moving = reach();
    expect(analyzeSignMotion([...moving, ...away(moving.at(-1)!, 2600)]).ready).toBe(false);
  });
  it("a movement that rested too long in view before the hand left is not revived", () => {
    const moving = reach();
    const rest = Array.from({ length: 60 }, (_, i) => ({ ...structuredClone(moving.at(-1)!), timestamp: moving.at(-1)!.timestamp + (i + 1) * 50 }));
    expect(analyzeSignMotion([...moving, ...rest, ...away(rest.at(-1)!, 400)]).ready).toBe(false);
  });
  it("still answers exactly as before while the hand is visible", () => {
    const moving = reach();
    expect(analyzeSignMotion(moving.slice(0, 8))).toMatchObject({ ready: false, reason: "moving" });
    const rest = Array.from({ length: 6 }, (_, i) => ({ ...structuredClone(moving.at(-1)!), timestamp: moving.at(-1)!.timestamp + (i + 1) * 50 }));
    expect(analyzeSignMotion([...moving, ...rest])).toMatchObject({ ready: true, completion: "rest" });
    expect(analyzeSignMotion([])).toMatchObject({ ready: false, reason: "hands" });
  });
});

describe("worker: a movement that ends by leaving the view", () => {
  it("reaches the research model and is offered as a suggestion, never confirmed", async () => {
    mocks.model.mockResolvedValue(book);
    const moving = reach();
    await feed(moving);
    expect(mocks.model).not.toHaveBeenCalled(); // still moving while visible
    await feed(away(moving.at(-1)!, 1500));
    expect(mocks.model).toHaveBeenCalledTimes(1);
    expect(mocks.model.mock.calls.every(([sequence]) => (sequence as VisionFrame[]).every(frame => frame.hands.length === 1))).toBe(true);
    expect(modelCandidates()).toContain("BOOK");
    expect(confirmed()).toEqual([]);
  });
  it("asks the model once when it declines: a frozen movement cannot change its answer", async () => {
    const moving = reach();
    await feed([...moving, ...away(moving.at(-1)!, 2400)]);
    expect(mocks.model).toHaveBeenCalledTimes(1);
    expect(modelCandidates()).toEqual([]);
  });
  it("does not offer the rest of a confirmed sign's movement as a new sign when the hand drops", async () => {
    mocks.model.mockResolvedValue(book);
    const sign = makeSign("THANK YOU");
    // Stop the fixture at the frame that confirms, so the tail follows the word directly.
    let confirmedAt = -1;
    for (const [index, frame] of sign.entries()) {
      await feed([frame]);
      if (confirmed().length) { confirmedAt = index; break; }
    }
    expect(confirmed()).toEqual(["THANK YOU"]);
    const calls = mocks.model.mock.calls.length;
    // The hand keeps travelling after the word, then leaves the view.
    const start = reach(12)[0].timestamp;
    const tail = reach(12).map(frame => ({ ...frame, timestamp: frame.timestamp - start + sign[confirmedAt].timestamp + 50 }));
    await feed([...tail, ...away(tail.at(-1)!, 1500)]);
    expect(mocks.model.mock.calls.length).toBe(calls);
    expect(modelCandidates()).toEqual([]);
    expect(confirmed()).toEqual(["THANK YOU"]);
  });
  it("accepts a new movement after the hand has left and come back", async () => {
    mocks.model.mockResolvedValue(book);
    const sign = makeSign("THANK YOU");
    await feed([...sign, ...away(sign.at(-1)!, 600)]);
    const next = reach().map(frame => ({ ...frame, timestamp: frame.timestamp - reach()[0].timestamp + sign.at(-1)!.timestamp + 700 }));
    await feed([...next, ...away(next.at(-1)!, 1500)]);
    expect(confirmed()).toEqual(["THANK YOU"]);
    expect(modelCandidates()).toContain("BOOK");
  });
  it("does not turn stale frames into a second suggestion after the first", async () => {
    mocks.model.mockResolvedValue(book);
    const moving = reach();
    await feed([...moving, ...away(moving.at(-1)!, 6000)]);
    expect(modelCandidates()).toContain("BOOK");
    expect(mocks.model).toHaveBeenCalledTimes(1);
    expect(messages().at(-1)).toMatchObject({ type: "analysis", candidate: null });
  });
  it("everyday movements that end by leaving the view never become confirmed words through the model", async () => {
    // A confidently wrong model: every segment it is shown is called BOOK.
    const report: Record<string, { confirmed: string[]; rulesOnly: string[]; suggested: string[] }> = {};
    for (const [name, make] of Object.entries(NEGATIVE_CONTROLS)) {
      const frames = make();
      const run = async (model: typeof book | null) => {
        await worker.onmessage({ data: { type: "reset" } });
        mocks.model.mockReset().mockResolvedValue(model);
        worker.postMessage.mockClear();
        await feed([...frames, ...away(frames.at(-1)!, 1500)]);
        return { confirmed: confirmed(), suggested: modelCandidates() };
      };
      const rules = await run(null), withModel = await run(book);
      report[name] = { confirmed: withModel.confirmed, rulesOnly: rules.confirmed, suggested: withModel.suggested };
      // The model adds suggestions only; the transcript is what the rules alone produce.
      expect(withModel.confirmed, name).toEqual(rules.confirmed);
      expect(withModel.confirmed.includes("BOOK"), name).toBe(false);
    }
    expect(Object.keys(report).length).toBeGreaterThanOrEqual(10);
  }, 15000);
});
