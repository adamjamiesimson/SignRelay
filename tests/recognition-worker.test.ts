import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VisionFrame, WorkerInput, WorkerMessage } from "../lib/vision-types";

const mocks = vi.hoisted(() => ({
  asl: vi.fn(), bsl: vi.fn(), isl: vi.fn(), lse: vi.fn(),
  motion: vi.fn(), personal: vi.fn(),
}));
vi.mock("../lib/asl1000-runtime", () => ({ recognizeAsl1000: mocks.asl }));
vi.mock("../lib/bsl1064-runtime", () => ({ recognizeBsl1064: mocks.bsl }));
vi.mock("../lib/isl263-runtime", () => ({ recognizeIsl263: mocks.isl }));
vi.mock("../lib/lse300-runtime", () => ({ recognizeLse300: mocks.lse }));
vi.mock("../lib/asl100-runtime", () => ({ hasAsl100CompletedSignMotion: mocks.motion }));
vi.mock("../lib/sign-motion", () => ({ analyzeSignMotion: (sequence: VisionFrame[]) => ({ ready: mocks.motion(), sequence, reason: "idle" }) }));
vi.mock("../lib/personalized-recognition", () => ({
  recognizePersonalTemplate: mocks.personal,
  templatesForLanguage: (templates: unknown[]) => templates,
}));

let worker: { onmessage: (event: { data: WorkerInput }) => Promise<void>; postMessage: ReturnType<typeof vi.fn> };
let timestamp: number;
const prediction = { label: "BOOK", text: "Book", confidence: 0.94, margin: 0.5 };

async function frames(count: number) {
  for (let i = 0; i < count; i++) {
    timestamp += 105;
    const frame: VisionFrame = { timestamp, hands: [], face: [], pose: [] };
    await worker.onmessage({ data: { type: "frame", frame } });
    await Promise.resolve();
  }
}
const confirmations = () => worker.postMessage.mock.calls.map(([m]) => m as WorkerMessage).filter(m => m.type === "confirmed");

beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  timestamp = 0;
  for (const id of ["asl", "bsl", "isl", "lse"] as const) mocks[id].mockResolvedValue(null);
  mocks.motion.mockReturnValue(true);
  mocks.personal.mockReturnValue(null);
  worker = { onmessage: async () => {}, postMessage: vi.fn() };
  vi.stubGlobal("self", worker);
  await import("../workers/recognition.worker");
});

describe("live worker regression coverage (synthetic control inputs, not sign accuracy)", () => {
  it.each(["asl", "bsl", "isl"] as const)("keeps %s inference running after the rolling buffer fills", async language => {
    await worker.onmessage({ data: { type: "templates", language, templates: [] } });
    await frames(90);
    const before = mocks[language].mock.calls.length;
    await frames(30);
    expect(mocks[language].mock.calls.length).toBeGreaterThan(before);
  });

  it.each(["asl", "bsl", "isl"] as const)("requires two independent %s predictions, not two reads of a cached result", async language => {
    await worker.onmessage({ data: { type: "templates", language, templates: [] } });
    mocks[language].mockResolvedValueOnce(prediction).mockImplementation(() => new Promise(() => {}));
    await frames(40);
    expect(confirmations()).toHaveLength(0);
  });

  it.each(["bsl", "isl"] as const)("rejects a pending %s result after motion stops", async language => {
    await worker.onmessage({ data: { type: "templates", language, templates: [] } });
    let finish!: (value: typeof prediction) => void;
    mocks[language].mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await frames(24);
    mocks.motion.mockReturnValue(false);
    await frames(1);
    finish(prediction);
    await frames(8);
    expect(confirmations()).toHaveLength(0);
    const messages = worker.postMessage.mock.calls.map(([m]) => m as WorkerMessage);
    expect(messages.at(-1)).toMatchObject({ type: "analysis", candidate: null });
  });

  it.each(["csl", "auslan", "lse"] as const)("does not call another language's classifier for %s without installed assets", async language => {
    await worker.onmessage({ data: { type: "templates", language, templates: [] } });
    await frames(100);
    for (const id of ["asl", "bsl", "isl", "lse"] as const) expect(mocks[id]).not.toHaveBeenCalled();
    expect(confirmations()).toHaveLength(0);
  });

  it("drops results from a previous language after switching", async () => {
    let finish!: (value: typeof prediction) => void;
    mocks.bsl.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await worker.onmessage({ data: { type: "templates", language: "bsl", templates: [] } });
    await frames(24);
    await worker.onmessage({ data: { type: "templates", language: "csl", templates: [] } });
    finish(prediction);
    await frames(10);
    expect(confirmations()).toHaveLength(0);
  });

  it.each(["asl", "bsl", "isl"] as const)("confirms two fresh matching %s predictions", async language => {
    await worker.onmessage({ data: { type: "templates", language, templates: [] } });
    mocks[language].mockResolvedValue(prediction);
    await frames(language === "asl" ? 14 : 34);
    expect(confirmations()).toHaveLength(1);
    expect(confirmations()[0]).toMatchObject({ gloss: "BOOK", text: "Book" });
    // Confirmation must consume the prediction; holding its cached output
    // cannot emit another word while the next inference is pending.
    mocks[language].mockImplementation(() => new Promise(() => {}));
    await frames(50);
    expect(confirmations()).toHaveLength(1);
  });

  it.each(["asl", "auslan", "bsl", "csl", "isl", "lse"] as const)("preserves personal recognition for %s", async language => {
    await worker.onmessage({ data: { type: "templates", language, templates: [] } });
    mocks.personal.mockReturnValue(prediction);
    // Personal templates and static starter signs have their own evidence gate.
    mocks.motion.mockReturnValue(false);
    await frames(2);
    expect(confirmations()).toHaveLength(1);
  });

  it.each([NaN, Infinity, -Infinity])("rejects non-finite confidence %s", async confidence => {
    mocks.personal.mockReturnValue({ ...prediction, confidence });
    await frames(8);
    expect(confirmations()).toHaveLength(0);
  });

  it("expires slow predictions instead of confirming an old sign", async () => {
    let finish!: (value: typeof prediction) => void;
    mocks.asl.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await frames(24);
    await frames(30);
    finish(prediction);
    await frames(2);
    expect(worker.postMessage.mock.calls.at(-1)?.[0]).toMatchObject({ candidate: null });
    expect(confirmations()).toHaveLength(0);
  });

  it("discards pending results after a session reset", async () => {
    let finish!: (value: typeof prediction) => void;
    mocks.asl.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await frames(24);
    await worker.onmessage({ data: { type: "reset" } });
    finish(prediction);
    await frames(2);
    expect(worker.postMessage.mock.calls.at(-1)?.[0]).toMatchObject({ candidate: null });
    expect(confirmations()).toHaveLength(0);
  });
  it("backs off a failed ASL load and resumes after the network recovers", async () => {
    mocks.asl.mockRejectedValue(new Error("Network unavailable"));
    await frames(6);
    await frames(40);
    expect(mocks.asl).toHaveBeenCalledOnce();
    expect(worker.postMessage.mock.calls.at(-1)?.[0]).toMatchObject({ feedback: expect.stringContaining("could not run") });
    mocks.asl.mockResolvedValue(prediction);
    await frames(20);
    expect(confirmations().map(result => result.gloss)).toEqual(["BOOK"]);
  });
});
