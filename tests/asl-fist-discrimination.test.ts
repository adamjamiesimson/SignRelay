import { beforeEach, describe, expect, it, vi } from "vitest";
import { recognizeAslStarter } from "../lib/asl-starter-recognition";
import { prepareCalibrationSequence } from "../lib/personalized-recognition";
import type { VisionFrame, WorkerInput, WorkerMessage } from "../lib/vision-types";
import { makeFistMotion } from "./fixtures/asl-fist-motion";

const mocks = vi.hoisted(() => ({ model: vi.fn() }));
vi.mock("../lib/asl1000-runtime", () => ({ recognizeAsl1000: mocks.model }));
let worker: { onmessage: (event: { data: WorkerInput }) => Promise<void>; postMessage: ReturnType<typeof vi.fn> };
const confirmations = () => worker.postMessage.mock.calls.map(([m]) => m as WorkerMessage)
  .filter(m => m.type === "confirmed").map(m => m.gloss);
async function feed(frames: VisionFrame[]) {
  for (const frame of frames) {
    await worker.onmessage({ data: { type: "frame", frame } });
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

describe("fist motion discrimination (synthetic regressions)", () => {
  it.each(["close", "bob", "point-bob", "tilt", "sideways"] as const)(
    "never calls %s YES, including before the movement finishes", async kind => {
      const frames = makeFistMotion(kind);
      for (let end = 1; end <= frames.length; end++) {
        expect(recognizeAslStarter(frames.slice(0, end))?.label, `frame ${end}`).not.toBe("YES");
      }
      await feed(frames);
      expect(confirmations()).toEqual([]);
    });
  it.each([
    { radiusX: 0.02, radiusY: 0.07 },
    { radiusX: 0.02, radiusY: 0.07, startAngle: Math.PI / 2, clockwise: false },
    { radiusX: 0.03, radiusY: 0.07, side: "Left" as const, scale: 0.65, jitter: 0.001 },
    { radiusX: 0.025, radiusY: 0.06, duration: 2400, count: 9 },
  ])("recognizes an uneven chest circle without prematurely saying YES: %j", async options => {
    const frames = makeFistMotion("sorry", options);
    for (let end = 1; end <= frames.length; end++) {
      expect(recognizeAslStarter(frames.slice(0, end))?.label, `frame ${end}`).not.toBe("YES");
    }
    expect(recognizeAslStarter(frames)?.label).toBe("SORRY");
    await feed(frames);
    expect(confirmations()).toEqual(["SORRY"]);
  });
  it.each([
    {},
    { side: "Left" as const, scale: 0.65, jitter: 0.001, pitchChange: 0.55 },
    { duration: 450, count: 13 },
    { duration: 2400, count: 9 },
  ])("recognizes a completed wrist nod even when the wrist stays in place: %j", async options => {
    const frames = makeFistMotion("nod", options);
    expect(recognizeAslStarter(frames)?.label).toBe("YES");
    await feed(frames);
    expect(confirmations()).toEqual(["YES"]);
  });
  it("waits for the return of the nod instead of accepting its outward bend", async () => {
    const frames = makeFistMotion("nod").slice(0, 14);
    for (let end = 1; end <= frames.length; end++) {
      expect(recognizeAslStarter(frames.slice(0, end))?.label).not.toBe("YES");
    }
    await feed(frames);
    expect(confirmations()).toEqual([]);
  });
  it.each(["close", "bob"] as const)("does not let a confident model bypass missing YES motion for %s", async kind => {
    mocks.model.mockResolvedValue({ label: "YES", text: "Yes", confidence: 0.99, margin: 0.9 });
    await feed(makeFistMotion(kind, { duration: 2600, count: 53 }));
    expect(mocks.model).toHaveBeenCalled();
    expect(confirmations()).toEqual([]);
  });
  it("ignores an isolated depth-tracking spike", async () => {
    const frames = makeFistMotion("tilt", { pitchChange: 0 });
    frames[12].hands = makeFistMotion("nod")[12].hands;
    for (let end = 1; end <= frames.length; end++) {
      expect(recognizeAslStarter(frames.slice(0, end))?.label).not.toBe("YES");
    }
    await feed(frames);
    expect(confirmations()).toEqual([]);
  });
  it("recognizes a later nod after rejecting fist preparation", async () => {
    await feed(makeFistMotion("close"));
    expect(confirmations()).toEqual([]);
    await feed(makeFistMotion("nod").map(frame => ({ ...frame, timestamp: frame.timestamp + 1650 })));
    expect(confirmations()).toEqual(["YES"]);
  });
  it("keeps inference running after rejecting a model YES", async () => {
    mocks.model.mockResolvedValue({ label: "YES", text: "Yes", confidence: 0.99, margin: 0.9 });
    await feed(makeFistMotion("bob", { duration: 2600, count: 53 }));
    expect(confirmations()).toEqual([]);
    mocks.model.mockResolvedValue({ label: "BOOK", text: "Book", confidence: 0.94, margin: 0.5 });
    await feed(makeFistMotion("bob", { duration: 2600, count: 53 })
      .map(frame => ({ ...frame, timestamp: frame.timestamp + 2650 })));
    expect(confirmations()).toEqual(["BOOK"]);
  });
  it("preserves an explicitly saved personal YES gesture", async () => {
    const frames = makeFistMotion("bob");
    await worker.onmessage({ data: { type: "templates", language: "asl", templates: [{
      id: "personal-yes", language: "asl", gloss: "YES", text: "Yes", createdAt: 1,
      frames: prepareCalibrationSequence(frames),
    }] } });
    await feed(frames);
    expect(confirmations()).toEqual(["YES"]);
  });
});
