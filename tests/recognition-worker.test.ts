import { installTemplateWorker } from "./helpers/template-worker";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VisionFrame, WorkerInput, WorkerMessage } from "../lib/vision-types";

const mocks = vi.hoisted(() => ({
  asl: vi.fn(), bsl: vi.fn(), isl: vi.fn(), lse: vi.fn(), psl: vi.fn(),
  warm: vi.fn(), motion: vi.fn(), personal: vi.fn(), openConflict: vi.fn(), starter: vi.fn(),
}));
vi.mock("../lib/asl-starter-recognition", async importOriginal => {
  const actual = await importOriginal<typeof import("../lib/asl-starter-recognition")>();
  return { ...actual, analyzeAslStarter: () => mocks.openConflict()
    ? { prediction: null, ambiguousOpenPalm: true, labels: ["HELLO", "THANK YOU"] }
    : mocks.starter() ?? { prediction: null, ambiguousOpenPalm: false, labels: [] } };
});
vi.mock("../lib/asl1000-runtime", () => ({ recognizeAsl1000: mocks.asl }));
vi.mock("../lib/bsl1064-runtime", () => ({
  // The real runtime returns its decision alongside the (possibly null) prediction.
  analyzeBsl1064: async (sequence: VisionFrame[], options: unknown) => {
    const result = await mocks.bsl(sequence, options);
    const decision = { status: result ? "accepted" : "uncertain", best: result?.label ?? "", top5: [],
      pTop1: result?.confidence ?? 0, margin: result?.margin ?? 0, windows: 1, spanFrames: 16, handFrames: 16, slotDisagreements: 0, inferenceMs: 1, reason: "" };
    (options as { onDecision?: (value: typeof decision) => void }).onDecision?.(decision);
    return { prediction: result ?? null, decision };
  },
  warmBsl1064: () => mocks.warm(),
}));
vi.mock("../lib/isl263-runtime", () => ({ recognizeIsl263: mocks.isl }));
vi.mock("../lib/lse300-runtime", () => ({ recognizeLse300: mocks.lse }));
vi.mock("../lib/psl776-runtime", () => ({ recognizePsl776: mocks.psl }));
vi.mock("../lib/asl100-runtime", () => ({
  analyzeGenericSignMotion: () => ({ ready: mocks.motion(), reason: mocks.motion() ? "ready" : "idle" }),
}));
vi.mock("../lib/sign-motion", () => ({ analyzeSignMotion: (sequence: VisionFrame[]) => ({ ready: mocks.motion(), sequence, reason: "idle" }) }));
vi.mock("../lib/personalized-recognition", () => ({
  recognizePersonalTemplate: mocks.personal,
  recognizePersonalTemplateAsync: mocks.personal,
  templatesForLanguage: (templates: unknown[]) => templates,
}));

let worker: { onmessage: (event: { data: WorkerInput }) => Promise<void>; postMessage: ReturnType<typeof vi.fn> };
let timestamp: number;
const prediction = { label: "BOOK", text: "Book", confidence: 0.94, margin: 0.5 };

async function frames(count: number) {
  for (let i = 0; i < count; i++) {
    timestamp += 105;
    const frame: VisionFrame = { timestamp, hands: [{ handedness: "Right", gesture: "None", gestureScore: 0, landmarks: Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 })) }], face: [], pose: [] };
    await worker.onmessage({ data: { type: "frame", frame } });
    await Promise.resolve();
  }
}
const suggestions = () => worker.postMessage.mock.calls.map(([m]) => m as WorkerMessage).filter(m => m.type === "suggestion");
const confirmations = () => worker.postMessage.mock.calls.map(([m]) => m as WorkerMessage).filter(m => m.type === "confirmed");
const candidates = () => worker.postMessage.mock.calls.map(([m]) => m as WorkerMessage).flatMap(m => m.type === "analysis" && m.candidate ? [m.candidate] : []);

beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  timestamp = 0;
  for (const id of ["asl", "bsl", "isl", "lse", "psl"] as const) mocks[id].mockResolvedValue(null);
  mocks.warm.mockResolvedValue(undefined);
  mocks.motion.mockReturnValue(true);
  mocks.openConflict.mockReturnValue(false);
  mocks.personal.mockReturnValue(null);
  worker = { onmessage: async () => {}, postMessage: vi.fn() };
  vi.stubGlobal("self", worker);
  installTemplateWorker();
  await import("../workers/recognition.worker");
});

describe("live worker regression coverage (synthetic control inputs, not sign accuracy)", () => {
  it.each(["asl", "isl", "lse", "psl"] as const)("keeps %s inference running after the rolling buffer fills", async language => {
    await worker.onmessage({ data: { type: "templates", language, templates: [] } });
    await frames(90);
    const before = mocks[language].mock.calls.length;
    await frames(30);
    expect(mocks[language].mock.calls.length).toBeGreaterThan(before);
  });

  it.each(["asl", "bsl", "isl", "lse", "psl"] as const)("requires two independent %s predictions, not two reads of a cached result", async language => {
    await worker.onmessage({ data: { type: "templates", language, templates: [] } });
    mocks[language].mockResolvedValueOnce(prediction).mockImplementation(() => new Promise(() => {}));
    await frames(40);
    expect(confirmations()).toHaveLength(0);
  });

  it.each(["bsl", "isl", "lse", "psl"] as const)("rejects a pending %s result after motion stops", async language => {
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

  it.each(["csl", "auslan", "uaesl", "vsl"] as const)("does not call another language's classifier for %s without installed assets", async language => {
    await worker.onmessage({ data: { type: "templates", language, templates: [] } });
    await frames(100);
    for (const id of ["asl", "bsl", "isl", "lse", "psl"] as const) expect(mocks[id]).not.toHaveBeenCalled();
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

  it("evaluates each completed BSL movement once, including after the rolling buffer fills", async () => {
    await worker.onmessage({ data: { type: "templates", language: "bsl", templates: [] } });
    await frames(90);
    expect(mocks.bsl).toHaveBeenCalledOnce();
    mocks.motion.mockReturnValue(false);
    await frames(5);
    mocks.motion.mockReturnValue(true);
    await frames(30);
    expect(mocks.bsl).toHaveBeenCalledTimes(2);
  });

  it("turns a BSL model match into one reviewable suggestion, never a transcript confirmation", async () => {
    await worker.onmessage({ data: { type: "templates", language: "bsl", templates: [] } });
    mocks.bsl.mockResolvedValue(prediction);
    await frames(4);
    expect(confirmations()).toHaveLength(0);
    expect(suggestions()).toHaveLength(1);
    expect(suggestions()[0]).toMatchObject({ gloss: "BOOK", text: "Book", source: "model" });
    // The same sign repeated straight away is a duplicate, not a second word.
    mocks.motion.mockReturnValue(false);
    await frames(2);
    mocks.motion.mockReturnValue(true);
    await frames(4);
    expect(mocks.bsl).toHaveBeenCalledTimes(2);
    expect(suggestions()).toHaveLength(1);
    // After the cooldown the same sign may be suggested again.
    mocks.motion.mockReturnValue(false);
    await frames(30);
    mocks.motion.mockReturnValue(true);
    await frames(4);
    expect(suggestions()).toHaveLength(2);
    expect(confirmations()).toHaveLength(0);
  });

  it("uses the legacy BSL input by default and the BSL-1K v2 contract only when requested", async () => {
    await worker.onmessage({ data: { type: "templates", language: "bsl", templates: [] } });
    await frames(4);
    expect(mocks.bsl.mock.calls[0][1]).toMatchObject({ engine: "legacy" });
    await worker.onmessage({ data: { type: "templates", language: "bsl", templates: [], bslEngine: "v2" } });
    await frames(4);
    expect(mocks.bsl.mock.calls[1][1]).toMatchObject({ engine: "v2" });
  });

  it("reports BSL stage diagnostics only when the page asks for them", async () => {
    await worker.onmessage({ data: { type: "templates", language: "bsl", templates: [] } });
    await frames(30);
    expect(worker.postMessage.mock.calls.some(([m]) => "bslDiagnostics" in m)).toBe(false);
    await worker.onmessage({ data: { type: "templates", language: "bsl", templates: [], diagnostics: true } });
    mocks.bsl.mockResolvedValue(prediction);
    await frames(30);
    const last = worker.postMessage.mock.calls.map(([m]) => m as WorkerMessage).filter(m => m.type === "analysis").at(-1);
    expect(last?.type === "analysis" && last.bslDiagnostics).toMatchObject({ engine: "legacy", signsCompleted: 1, inferences: 1,
      suggestionsPosted: 1, decisions: { accepted: 1 } });
  });

  it.each(["isl", "lse", "psl"] as const)("confirms two fresh matching %s predictions", async language => {
    await worker.onmessage({ data: { type: "templates", language, templates: [] } });
    mocks[language].mockResolvedValue(prediction);
    await frames(34);
    expect(confirmations()).toHaveLength(1);
    expect(confirmations()[0]).toMatchObject({ gloss: "BOOK", text: "Book" });
    // Confirmation must consume the prediction; holding its cached output
    // cannot emit another word while the next inference is pending.
    mocks[language].mockImplementation(() => new Promise(() => {}));
    await frames(50);
    expect(confirmations()).toHaveLength(1);
  });

  it("keeps matching ASL model predictions tentative", async () => {
    mocks.asl.mockResolvedValue(prediction);
    await frames(14);
    expect(mocks.asl.mock.calls.length).toBeGreaterThan(1);
    expect(candidates()).toContain("BOOK");
    expect(confirmations()).toHaveLength(0);
  });

  it.each(["asl", "auslan", "bsl", "csl", "isl", "lse", "psl", "uaesl", "vsl"] as const)("preserves personal recognition for %s", async language => {
    await worker.onmessage({ data: { type: "templates", language, templates: [] } });
    mocks.personal.mockReturnValue(prediction);
    await worker.onmessage({ data: { type: "templates", language, templates: [{ id: "saved", gloss: "BOOK", text: "Book", createdAt: 1, frames: [] }] } });
    // Personal templates and static starter signs have their own evidence gate.
    mocks.motion.mockReturnValue(false);
    await frames(4);
    expect(confirmations()).toHaveLength(1);
  });

  it.each(["bsl", "isl", "lse", "psl"] as const)("gives %s the same ready-state feedback text ASL already gets, instead of none", async language => {
    await worker.onmessage({ data: { type: "templates", language, templates: [] } });
    mocks.motion.mockReturnValue(true);
    await frames(1);
    const last = worker.postMessage.mock.calls.at(-1)?.[0] as WorkerMessage;
    expect(last).toMatchObject({ feedback: "Ready. Sign naturally, then pause briefly between words." });
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
    expect(candidates()).toContain("BOOK");
    expect(confirmations()).toHaveLength(0);
  });

  it.each([0, -400, 1000])("invalidates an in-flight model when the frame clock jumps by %d ms", async gap => {
    let finish!: (value: typeof prediction) => void;
    mocks.asl.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await frames(8);
    timestamp += gap - 105;
    await frames(1);
    finish(prediction);
    await frames(2);
    expect(candidates()).toEqual([]);
    expect(worker.postMessage.mock.calls.at(-1)?.[0]).toMatchObject({ bufferSize: 3 });
  });
  it("lets a completed BSL sign wait for a slow initial model download instead of faulting", async () => {
    mocks.warm.mockImplementation(() => new Promise(() => {}));
    await worker.onmessage({ data: { type: "templates", language: "bsl", templates: [] } });
    await frames(270);
    expect(worker.postMessage.mock.calls.some(([m]) => m.type === "fault")).toBe(false);
    expect(mocks.bsl).not.toHaveBeenCalled();
  });

  it.each(["isl"] as const)("allows a slow initial %s model download beyond 20 seconds", async language => {
    mocks[language].mockImplementation(() => new Promise(() => {}));
    await worker.onmessage({ data: { type: "templates", language, templates: [] } });
    await frames(270);
    const faults = worker.postMessage.mock.calls.map(([m]) => m as WorkerMessage)
      .filter(message => message.type === "fault");
    expect(mocks[language]).toHaveBeenCalled();
    expect(faults).toHaveLength(0);
  });

  it("does not allow a previous language's pending download to restart the current session", async () => {
    mocks.bsl.mockImplementation(() => new Promise(() => {}));
    await worker.onmessage({ data: { type: "templates", language: "bsl", templates: [] } });
    await frames(28);
    await worker.onmessage({ data: { type: "templates", language: "csl", templates: [] } });
    await frames(250);
    const faults = worker.postMessage.mock.calls.map(([m]) => m as WorkerMessage)
      .filter(message => message.type === "fault");
    expect(faults).toHaveLength(0);
  });

  it("requests recovery if a model never resolves, instead of leaving it permanently pending", async () => {
    mocks.asl.mockImplementation(() => new Promise(() => {}));
    await frames(200);
    const faults = worker.postMessage.mock.calls.map(([message]) => message as WorkerMessage).filter(message => message.type === "fault");
    expect(faults).toHaveLength(1);
    expect(faults[0]).toMatchObject({ message: expect.stringContaining("stopped responding") });
    expect(confirmations()).toHaveLength(0);
  });

  it.each(["bsl", "isl"] as const)("keeps %s downloads distinct from the inference watchdog, including abstentions", async language => {
    let download!: () => void;
    mocks[language].mockImplementationOnce(async (_frames, options) => {
      options.onPhase("loading"); await new Promise<void>(resolve => { download = resolve; });
      options.onPhase("inference"); return null;
    });
    await worker.onmessage({ data: { type: "templates", language, templates: [] } });
    await frames(500); // 52.5s of arriving frames while the download progresses
    expect(worker.postMessage.mock.calls.some(([m]) => m.type === "fault")).toBe(false);
    download(); await Promise.resolve(); await Promise.resolve();
    mocks[language].mockImplementation((_frames, options) => {
      options.onPhase("inference"); return new Promise(() => {});
    });
    // BSL evaluates once per completed movement: let the first finish, then start a new one.
    await frames(2);
    mocks.motion.mockReturnValueOnce(false);
    await frames(210);
    expect(worker.postMessage.mock.calls.filter(([m]) => m.type === "fault")).toHaveLength(1);
  });

  it.each(["reset", "templates"] as const)("aborts an old BSL download on %s and ignores its rejection", async type => {
    let signal!: AbortSignal, fail!: (error: Error) => void;
    mocks.bsl.mockImplementation((_frames, options) => {
      signal = options.signal; options.onPhase("loading");
      return new Promise((_resolve, reject) => { fail = reject; });
    });
    await worker.onmessage({ data: { type: "templates", language: "bsl", templates: [] } });
    await frames(24);
    await worker.onmessage({ data: type === "reset" ? { type } : { type, language: "csl", templates: [] } });
    expect(signal.aborted).toBe(true); fail(new Error("cancelled old download"));
    await frames(2);
    expect(worker.postMessage.mock.calls.at(-1)?.[0].feedback).not.toContain("could not run");
    expect(confirmations()).toHaveLength(0);
  });
  it("does not fall through a repeated-starter block to a model word", async () => {
    mocks.starter.mockReturnValue({ prediction: { label: "HELLO", text: "Hello", confidence: 0.86 },
      ambiguousOpenPalm: false, labels: ["HELLO"] });
    mocks.asl.mockResolvedValue(prediction);
    await frames(20);
    expect(mocks.asl).toHaveBeenCalled();
    expect(confirmations().map(result => result.gloss)).toEqual(["HELLO"]);
  });

  it("does not combine starter and model predictions into a confirmation streak", async () => {
    mocks.asl.mockResolvedValueOnce(prediction).mockImplementation(() => new Promise(() => {}));
    await frames(6);
    mocks.starter.mockReturnValueOnce({ prediction, ambiguousOpenPalm: false, labels: ["BOOK"] });
    await frames(1);
    expect(worker.postMessage.mock.calls.at(-1)?.[0]).toMatchObject({ candidate: "BOOK", source: "starter" });
    await frames(1);
    expect(worker.postMessage.mock.calls.at(-1)?.[0]).toMatchObject({ candidate: "BOOK", source: "model" });
    expect(confirmations()).toHaveLength(0);
  });

  it("breaks a starter streak when a cached ASL model word is the only candidate between observations", async () => {
    mocks.asl.mockResolvedValueOnce(prediction).mockImplementation(() => new Promise(() => {}));
    const starter = { prediction, ambiguousOpenPalm: false, labels: ["BOOK"] };
    await frames(7); // The model result was received and used in one analysis.
    mocks.starter.mockReturnValueOnce(starter);
    await frames(1);
    await frames(1); // The same model candidate is still visible, but the starter abstained.
    mocks.starter.mockReturnValueOnce(starter);
    await frames(1);
    expect(confirmations()).toHaveLength(0);
  });

  it("expires model results by elapsed time when camera timestamps stall", async () => {
    vi.useFakeTimers();
    try {
      let finish!: (value: typeof prediction) => void;
      mocks.asl.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
      await frames(6);
      await vi.advanceTimersByTimeAsync(3000);
      finish(prediction); await Promise.resolve();
      await frames(1);
      expect(worker.postMessage.mock.calls.at(-1)?.[0]).toMatchObject({ candidate: null });
      expect(confirmations()).toHaveLength(0);
    } finally { vi.useRealTimers(); }
  });

  it("invalidates a high-scoring model candidate when open-palm evidence conflicts", async () => {
    mocks.asl.mockResolvedValue({ ...prediction, label: "PLEASE" });
    await frames(7);
    expect(mocks.asl).toHaveBeenCalled();
    mocks.openConflict.mockReturnValue(true);
    await frames(8);
    expect(confirmations()).toHaveLength(0);
    expect(worker.postMessage.mock.calls.at(-1)?.[0]).toMatchObject({ candidate: null,
      feedback: expect.stringContaining("more than one sign") });
  });

});
