import { beforeEach, describe, expect, it, vi } from "vitest";
import { flatHand } from "../lib/asl-starter-recognition";
import type { HandObservation, VisionFrame, WorkerInput, WorkerMessage } from "../lib/vision-types";
import { handshape, makeSign } from "./fixtures/asl-motion";

// THANK YOU needs a flat hand. On 79 PopSign test clips the rule was right on
// 3 clips and wrong on 11, mostly other signs made at the face with other
// handshapes. Synthetic kinematics: these show what the rule does, not how
// often real signs are recognised.
const mocks = vi.hoisted(() => ({ model: vi.fn() }));
vi.mock("../lib/asl1000-runtime", () => ({ recognizeAsl1000: mocks.model }));
let worker: { onmessage: (event: { data: WorkerInput }) => Promise<void>; postMessage: ReturnType<typeof vi.fn> };
const confirmed = () => worker.postMessage.mock.calls.map(([m]) => m as WorkerMessage).flatMap(m => m.type === "confirmed" ? [m.gloss] : []);
async function feed(frames: VisionFrame[]) {
  for (const frame of frames) { await worker.onmessage({ data: { type: "frame", frame } }); await Promise.resolve(); }
}
const hand = (landmarks = handshape("open")): HandObservation => ({ landmarks, handedness: "Right", gesture: "None", gestureScore: 0 });
/** Fan the four fingers out from the knuckles, like a spread 5-hand. */
function spread(points = handshape("open"), amount = 0.9) {
  const out = points.map(point => ({ ...point }));
  for (let finger = 0; finger < 4; finger++) {
    const mcp = 5 + finger * 4, lean = (finger - 1.5) * amount;
    for (let joint = 1; joint <= 3; joint++) out[mcp + joint].x += (out[mcp + joint].y - out[mcp].y) * -lean * 0.35;
  }
  return out;
}
/** Fold the little finger: three extended fingers, as in WATER. */
function threeFingers(points = handshape("open")) {
  const out = points.map(point => ({ ...point }));
  out[19] = { ...out[19], y: -0.083 }; out[20] = { ...out[20], y: -0.063 };
  return out;
}
/** Replace the handshape of every frame, keeping each frame's wrist position and scale. */
function reshape(frames: VisionFrame[], shape: (points: ReturnType<typeof handshape>) => ReturnType<typeof handshape>) {
  const base = handshape("open");
  return frames.map(frame => ({ ...frame, hands: frame.hands.map(observation => {
    const wrist = observation.landmarks[0];
    const scale = Math.hypot(observation.landmarks[9].x - wrist.x, observation.landmarks[9].y - wrist.y) / Math.hypot(base[9].x, base[9].y);
    return { ...observation, landmarks: shape(base).map(point => ({ x: wrist.x + point.x * scale, y: wrist.y + point.y * scale, z: point.z })) };
  }) }));
}

beforeEach(async () => {
  vi.resetModules();
  mocks.model.mockReset().mockResolvedValue(null);
  worker = { onmessage: async () => {}, postMessage: vi.fn() };
  vi.stubGlobal("self", worker);
  await import("../workers/recognition.worker");
});

describe("flat hand", () => {
  it("accepts four extended fingers held together", () => expect(flatHand(hand())).toBe(true));
  it("rejects spread fingers, three fingers and a fist", () => {
    expect(flatHand(hand(spread()))).toBe(false);
    expect(flatHand(hand(threeFingers()))).toBe(false);
    expect(flatHand(hand(handshape("fist")))).toBe(false);
  });
  it("tolerates a slightly relaxed flat hand", () => expect(flatHand(hand(spread(handshape("open"), 0.25)))).toBe(true));
});

describe("THANK YOU needs a flat hand", () => {
  it("still confirms the flat-hand THANK YOU fixture (after reshaping, to prove the helper preserves the movement)", async () => {
    await feed(reshape(makeSign("THANK YOU"), points => points));
    expect(confirmed()).toEqual(["THANK YOU"]);
  });
  it.each([["a spread hand", spread], ["three extended fingers", threeFingers]] as const)(
    "does not call the same movement THANK YOU with %s", async (_name, shape) => {
      await feed(reshape(makeSign("THANK YOU"), shape));
      expect(confirmed()).not.toContain("THANK YOU");
    });
  it("leaves HELLO and PLEASE to their own rules with a spread hand", async () => {
    await feed(reshape(makeSign("PLEASE"), spread));
    expect(confirmed()).toEqual(["PLEASE"]);
  });
});
