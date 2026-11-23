import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MODEL_ADAPTERS } from "../lib/model-adapters";
import type { VisionFrame, WorkerInput, WorkerMessage } from "../lib/vision-types";
import { makeSign } from "./fixtures/asl-motion";

// Decision arbitration with the real worker; model outputs are mocked.
const mocks = vi.hoisted(() => ({ model: vi.fn(), bsl: vi.fn() }));
vi.mock("../lib/asl1000-runtime", () => ({ recognizeAsl1000: mocks.model }));
vi.mock("../lib/bsl1064-runtime", () => ({ recognizeBsl1064: mocks.bsl }));
type Port = { onmessage: (event: { data: WorkerInput }) => Promise<void>; postMessage: ReturnType<typeof vi.fn> };
let worker: Port;
async function freshWorker() {
  vi.resetModules();
  worker = { onmessage: async () => {}, postMessage: vi.fn() };
  vi.stubGlobal("self", worker);
  await import("../workers/recognition.worker");
  return worker;
}
const sent = () => worker.postMessage.mock.calls.map(([m]) => m as WorkerMessage);
const confirmations = () => sent().filter(m => m.type === "confirmed").map(m => (m as { gloss: string }).gloss);
async function feed(frames: VisionFrame[]) {
  for (const frame of frames) { await worker.onmessage({ data: { type: "frame", frame } }); await Promise.resolve(); }
}
/** A completed sideways movement that no starter rule claims, so only the model can name it. */
function modelOnlyMovement(duration = 1600, count = 33, offset = 0) {
  const frames = makeSign("IDLE", { duration, count });
  frames.forEach((frame, index) => {
    frame.timestamp += offset;
    frame.hands[0].landmarks.forEach(point => { point.y += 0.3; point.x += Math.min(1, index / 10) * 0.12; });
  });
  return frames;
}
beforeEach(async () => {
  mocks.model.mockReset().mockResolvedValue(null);
  mocks.bsl.mockReset().mockResolvedValue(null);
  await freshWorker();
});

describe("deterministic decision arbitration", () => {
  it("produces identical messages for identical input", async () => {
    const stream = [...makeSign("NO"), ...makeSign("PLEASE").map(f => ({ ...f, timestamp: f.timestamp + 1000 }))];
    await feed(stream);
    const first = sent().map(({ ...message }) => ({ ...message, timestamp: undefined }));
    await freshWorker();
    await feed(structuredClone(stream));
    expect(sent().map(({ ...message }) => ({ ...message, timestamp: undefined }))).toEqual(first);
    expect(confirmations()).toEqual(["NO", "PLEASE"]);
  });
  it("does not confirm when confident model results keep disagreeing", async () => {
    let call = 0;
    mocks.model.mockImplementation(async () => ({ ...[{ label: "BOOK", text: "Book" }, { label: "CHAIR", text: "Chair" }][call++ % 2], confidence: 0.97, margin: 0.6 }));
    await feed(modelOnlyMovement());
    expect(mocks.model.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(confirmations()).toEqual([]);
  });
  it("does not combine evidence from before and after a session reset", async () => {
    mocks.model.mockResolvedValueOnce({ label: "BOOK", text: "Book", confidence: 0.97, margin: 0.6 }).mockResolvedValue(null);
    const movement = modelOnlyMovement();
    await feed(movement.slice(0, 22));
    await worker.onmessage({ data: { type: "reset" } });
    mocks.model.mockResolvedValueOnce({ label: "BOOK", text: "Book", confidence: 0.97, margin: 0.6 }).mockResolvedValue(null);
    await feed(modelOnlyMovement(1600, 33, 2000));
    expect(confirmations()).toEqual([]);
  });
  it("discards an ASL inference that finishes after switching to BSL", async () => {
    let finish: (value: unknown) => void = () => {};
    mocks.model.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await feed(modelOnlyMovement().slice(0, 25));
    expect(mocks.model).toHaveBeenCalledTimes(1);
    await worker.onmessage({ data: { type: "templates", language: "bsl", templates: [] } });
    finish({ label: "BOOK", text: "Book", confidence: 0.99, margin: 0.9 });
    await Promise.resolve();
    await feed(modelOnlyMovement(1600, 33, 2000));
    expect(sent().some(m => m.type === "analysis" && m.candidate === "BOOK")).toBe(false);
    expect(confirmations()).toEqual([]);
  });
});

describe("one confidence policy per runtime", () => {
  it.each([["asl", "asl1000-runtime", "MODEL_MIN_CONFIDENCE"], ["bsl", "bsl1064-runtime", "MIN_CONFIDENCE"],
    ["isl", "isl263-runtime", "MIN_CONFIDENCE"], ["lse", "lse300-runtime", "MIN_CONFIDENCE"]] as const)(
    "%s runtime floor equals its registry threshold", (language, file, constant) => {
      const source = readFileSync(`lib/${file}.ts`, "utf8");
      const value = Number(source.match(new RegExp(`const ${constant} = ([0-9.]+);`))?.[1]);
      expect(value).toBe(MODEL_ADAPTERS[language].confidenceThreshold);
    });
  it("the worker never confirms below the lowest registry threshold", () => {
    const worker = readFileSync("workers/recognition.worker.ts", "utf8");
    const floor = Number(worker.match(/const CONFIDENCE_THRESHOLD = ([0-9.]+);/)?.[1]);
    const automatic = Object.values(MODEL_ADAPTERS).filter(model => model.status === "experimental" && model.confidenceThreshold > 0);
    expect(floor).toBe(Math.min(...automatic.map(model => model.confidenceThreshold)));
  });
});
