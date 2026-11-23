import { beforeEach, describe, expect, it, vi } from "vitest";
import { N_POINTS } from "../engine-v3/web/preprocess.mjs";
import type { AslV31Suggestion } from "../lib/asl-v31-runtime";
import type { WorkerInput, WorkerMessage } from "../lib/vision-types";
import { installTemplateWorker } from "./helpers/template-worker";

const mock = vi.hoisted(() => ({ warm: vi.fn(), recognize: vi.fn(), personal: vi.fn(), legacy: vi.fn() }));
vi.mock("../lib/asl-v31-runtime", () => ({ warmAslV31Model: mock.warm, recognizeAslV31: mock.recognize }));
vi.mock("../lib/asl1000-runtime", () => ({ recognizeAsl1000: mock.legacy }));
vi.mock("../lib/personalized-recognition", () => ({
  recognizePersonalTemplate: mock.personal,
  recognizePersonalTemplateAsync: mock.personal,
  templatesForLanguage: (templates: unknown[]) => templates,
}));

let worker: { onmessage: (event: { data: WorkerInput }) => Promise<void>; postMessage: ReturnType<typeof vi.fn> };
let timestamp: number;
const suggestion = { label: "THANK-YOU", text: "Thank You", confidence: 0.92 };
const messages = (type: WorkerMessage["type"]) => worker.postMessage.mock.calls.map(([message]) => message as WorkerMessage).filter(message => message.type === type);

async function configure(session = 1, language: "asl" | "csl" = "asl", withTemplate = false) {
  const templates = withTemplate ? [{ id: "p", gloss: "SAVED", text: "Saved", createdAt: 1, frames: [] }] : [];
  await worker.onmessage({ data: { type: "templates", language, templates, session, aslEngine: "v3.1" } });
}

async function feed(count: number, visible: boolean, session = 1) {
  for (let index = 0; index < count; index++) {
    const aslV3Features = new Float32Array(N_POINTS * 3).fill(NaN);
    // A sign is movement: the segmenter opens on a moving hand inside signing space, not on a
    // hand that merely sits there, so the fixture strokes 0.02 of the frame per 100 ms frame.
    const point = { x: 0.4 + 0.02 * (index % 5), y: 0.2, z: 0 };
    // Shoulders put the signing-space limit at y = 0.76, so y = 0.2 is a signing hand.
    aslV3Features.set([0.4, 0.5, 0], (42 + 7) * 3);
    aslV3Features.set([0.6, 0.5, 0], (42 + 8) * 3);
    if (visible) aslV3Features.set([point.x, point.y, point.z]);
    await worker.onmessage({ data: { type: "frame", session, frameId: timestamp, frame: { timestamp, aslV3Features, pose: [], face: [],
      hands: visible ? [{ handedness: "Right", gesture: "None", gestureScore: 0, landmarks: Array.from({ length: 21 }, () => point) }] : [],
    } } });
    timestamp += 100;
    await Promise.resolve();
  }
}

beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  mock.warm.mockResolvedValue(undefined);
  mock.recognize.mockResolvedValue(suggestion);
  mock.personal.mockResolvedValue(null);
  worker = { onmessage: async () => {}, postMessage: vi.fn() };
  timestamp = 0;
  vi.stubGlobal("self", worker);
  installTemplateWorker();
  await import("../workers/recognition.worker");
});

describe("selected V3.1 ASL worker", () => {
  it("acknowledges every frame and offers one final candidate for manual review", async () => {
    await configure();
    await feed(9, true);
    expect(mock.recognize).not.toHaveBeenCalled();
    await feed(12, false);
    expect(mock.warm).toHaveBeenCalledOnce();
    expect(mock.recognize).toHaveBeenCalledOnce();
    expect(mock.legacy).not.toHaveBeenCalled();
    expect(messages("analysis")).toHaveLength(21);
    expect(messages("confirmed")).toHaveLength(0);
    expect(messages("suggestion")).toEqual([expect.objectContaining({ session: 1, gloss: "THANK-YOU", text: "Thank You", source: "model" })]);
  });

  it("hands the landing-page developer the exact window and decision for a live misrecognition", async () => {
    mock.recognize.mockImplementation(async (_frames: Float32Array[], options: { onDecision?: (decision: object) => void }) => {
      options.onDecision?.({ status: "accepted", best: "THANK-YOU", top3: [{ label: "THANK-YOU", p: 0.92 }],
        pTop1: 0.92, pUnknown: 0.01, proto: 0.9, handFrames: 12, reason: "" });
      return suggestion;
    });
    await configure();
    await worker.onmessage({ data: { type: "capture", session: 1 } });
    expect(messages("clip")).toEqual([expect.objectContaining({ session: 1, sign: null })]);
    await feed(9, true);
    await feed(12, false);
    await worker.onmessage({ data: { type: "capture", session: 1 } });
    const [capture] = messages("clip").slice(-1) as { sign: Record<string, unknown> | null }[];
    const sign = capture.sign as { tool: string; frames: number; clip: unknown[]; decision: { status: string } | null;
      model: { sha256: string }; contract: { points: number } };
    expect(sign.tool).toBe("signrelay-live-clip-v1");
    expect(sign.frames).toBeGreaterThan(0);
    expect(sign.clip).toHaveLength(sign.frames);
    expect(sign.decision?.status).toBe("accepted");
    expect(sign.model.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(sign.contract.points).toBe(N_POINTS);
  });

  it("confirms a sign the signer taught instead of guessing from the 523-class head", async () => {
    const embedding = [1, 0, 0, 0];
    mock.recognize.mockImplementation(async (_frames: Float32Array[], options: { onEmbedding?: (value: number[]) => void }) => {
      options.onEmbedding?.(embedding);
      return { ...suggestion, label: "HOME", text: "Home", confidence: 0.3 };
    });
    await worker.onmessage({ data: { type: "templates", language: "asl", aslEngine: "v3.1", session: 1, diagnostics: false,
      templates: [{ id: "p", gloss: "MORE", text: "More", createdAt: 1, frames: [], language: "asl", embedding }] } });
    await feed(9, true);
    await feed(12, false);
    expect(messages("confirmed")).toEqual([expect.objectContaining({ gloss: "MORE", text: "More", source: "personal" })]);
    expect(messages("suggestion")).toHaveLength(0);
  });

  it("does not run the ASL model in another language even when V3.1 was requested", async () => {
    await configure(2, "csl");
    await feed(9, true, 2);
    await feed(12, false, 2);
    expect(mock.warm).not.toHaveBeenCalled();
    expect(mock.recognize).not.toHaveBeenCalled();
  });

  it("drops delayed candidates from prior camera and language sessions", async () => {
    await configure();
    let finish!: (result: AslV31Suggestion) => void;
    mock.recognize.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await feed(9, true);
    await feed(10, false);
    expect(mock.recognize).toHaveBeenCalledOnce();
    await configure(2, "csl");
    finish(suggestion);
    await feed(2, false, 2);
    expect(messages("suggestion")).toHaveLength(0);
  });

  it("keeps abstentions out of the transcript and allows a repeat after a fresh boundary", async () => {
    await configure();
    mock.recognize.mockResolvedValueOnce(null);
    await feed(8, true);
    await feed(8, false);
    expect(messages("suggestion")).toHaveLength(0);
    await feed(8, true);
    await feed(8, false);
    expect(messages("suggestion")).toHaveLength(1);
    expect(messages("confirmed")).toHaveLength(0);
  });

  it("preserves personal-template confirmation with one arbitration path", async () => {
    await configure(1, "asl", true);
    mock.personal.mockReturnValue({ label: "SAVED", text: "Saved", confidence: 0.9 });
    await feed(9, true);
    await feed(10, false);
    expect(messages("confirmed")).toEqual([expect.objectContaining({ source: "personal", gloss: "SAVED" })]);
    expect(messages("suggestion")).toHaveLength(0);
    expect(mock.recognize).not.toHaveBeenCalled();
  });

  it("reports stage diagnostics only when the page asks for them, including a rejected decision", async () => {
    await configure();
    await feed(9, true);
    await feed(12, false);
    expect(messages("analysis").every(message => !("diagnostics" in message))).toBe(true);

    await worker.onmessage({ data: { type: "templates", language: "asl", templates: [], session: 2, aslEngine: "v3.1", diagnostics: true } });
    mock.recognize.mockImplementation(async (_frames: unknown, options: { onDecision?: (decision: unknown) => void }) => {
      options.onDecision?.({ status: "unknown", best: "PLEASE", top3: [{ label: "PLEASE", p: 0.9 }], pTop1: 0.9, pUnknown: 0,
        proto: 0.7, handFrames: 9, reason: "unlike training examples of PLEASE (similarity 0.70 < 0.81)" });
      return null;
    });
    await feed(9, true, 2);
    await feed(12, false, 2);
    const last = messages("analysis").at(-1);
    expect(last?.type === "analysis" && last.diagnostics).toMatchObject({
      observations: 21, handFrames: 9, segmentsOpened: 1, segmentsCompleted: 1, model: "ready", inferences: 1,
      decisions: { accepted: 0, unknown: 1 }, suggestionsPosted: 0,
      lastDecision: expect.objectContaining({ best: "PLEASE", reason: expect.stringContaining("similarity") }),
    });
    expect(messages("suggestion")).toHaveLength(1); // only the earlier, accepted session
  });
});
