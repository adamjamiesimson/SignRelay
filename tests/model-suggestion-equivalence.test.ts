// Model-output provenance proof (F1, extended to every language in the
// starter-reliability sprint). The same scenario corpus runs through the release
// candidate's worker as it was before the safeguard (frozen fixture) and the
// current worker, with identical deterministic model behaviour. The ONLY
// allowed difference: a confirmation whose source is a research model (ASL-2000,
// BSL-1064, ISL-263, LSE-300, PSL matcher) becomes a `suggested` message. Every analysis message, every starter-rule and
// personal-sign confirmation, and every other language's behaviour must be
// identical, message for message.
import { mkdirSync, writeFileSync } from "node:fs";
import { installTemplateWorker } from "./helpers/template-worker";
import { afterAll, describe, expect, it, vi } from "vitest";
import { prepareCalibrationSequence } from "../lib/personalized-recognition";
import type { VisionFrame, WorkerInput, WorkerMessage } from "../lib/vision-types";
import { makeSign, type Sign } from "./fixtures/asl-motion";
import { NEGATIVE_CONTROLS } from "./fixtures/asl-negative-controls";

const mocks = vi.hoisted(() => ({ model: vi.fn(), bsl: vi.fn() }));
vi.mock("../lib/asl1000-runtime", () => ({ recognizeAsl1000: mocks.model }));
vi.mock("../lib/bsl1064-runtime", () => ({ recognizeBsl1064: mocks.bsl }));

type Port = { onmessage: (event: { data: WorkerInput }) => Promise<void>; postMessage: ReturnType<typeof vi.fn> };
type Step = { frames: VisionFrame[] } | { input: WorkerInput };
type ModelBehaviour = "silent" | "book" | "echo-sign" | "disagree" | "slow-book" | "fails" | "low-confidence";
type Scenario = { name: string; behaviour: ModelBehaviour; steps: () => Step[]; bsl?: boolean };

const shift = (frames: VisionFrame[], by: number) => frames.map(f => ({ ...structuredClone(f), timestamp: f.timestamp + by }));
/** A completed movement no starter rule claims, so only the model can name it. */
function modelOnly(offset = 0) {
  const frames = makeSign("IDLE", { duration: 1600, count: 33 });
  frames.forEach((frame, index) => frame.hands[0].landmarks.forEach(point => { point.y += 0.3; point.x += Math.min(1, index / 10) * 0.12; }));
  return shift(frames, offset);
}
/** Remove the hands from part of a movement (tracking interruption). */
function interrupted(frames: VisionFrame[], from: number, to: number) {
  return frames.map((f, i) => i >= from && i < to ? { ...f, hands: [] } : f);
}
const SIGNS: Sign[] = ["HELLO", "NO", "YES", "PLEASE", "SORRY", "THANK YOU"];
let currentSign = "BOOK";
const personalTemplate = () => ({ type: "templates" as const, language: "asl" as const, templates: [{
  id: "p1", language: "asl" as const, gloss: "MY SIGN", text: "My sign", createdAt: 1, normalization: "trajectory-v3" as const,
  frames: prepareCalibrationSequence(modelOnly(), "trajectory-v3"),
}] });

const SCENARIOS: Scenario[] = [
  ...SIGNS.map(sign => ({ name: `starter ${sign}, model silent`, behaviour: "silent" as const, steps: () => [{ frames: makeSign(sign) }] })),
  ...SIGNS.map(sign => ({ name: `starter ${sign}, model agrees`, behaviour: "echo-sign" as const, steps: () => [{ frames: makeSign(sign) }] })),
  ...SIGNS.map(sign => ({ name: `starter ${sign}, model says BOOK`, behaviour: "book" as const, steps: () => [{ frames: makeSign(sign) }] })),
  { name: "model-only movement", behaviour: "book", steps: () => [{ frames: modelOnly() }] },
  { name: "model-only, repeated within cooldown", behaviour: "book", steps: () => [{ frames: modelOnly() }, { frames: modelOnly(1700) }] },
  { name: "model-only, repeated after cooldown", behaviour: "book", steps: () => [{ frames: modelOnly() }, { frames: modelOnly(6000) }] },
  { name: "model results keep disagreeing", behaviour: "disagree", steps: () => [{ frames: modelOnly() }] },
  { name: "low-confidence model", behaviour: "low-confidence", steps: () => [{ frames: modelOnly() }] },
  { name: "delayed model inference", behaviour: "slow-book", steps: () => [{ frames: modelOnly() }, { frames: modelOnly(1700) }] },
  { name: "model inference fails", behaviour: "fails", steps: () => [{ frames: modelOnly() }] },
  { name: "starter, model-only, starter", behaviour: "book", steps: () => [{ frames: makeSign("HELLO") }, { frames: modelOnly(2000) }, { frames: shift(makeSign("NO"), 4200) }] },
  { name: "model-only then same-label starter", behaviour: "echo-sign", steps: () => { currentSign = "HELLO"; return [{ frames: modelOnly() }, { frames: shift(makeSign("HELLO"), 1700) }]; } },
  { name: "tracking interruption mid model-only", behaviour: "book", steps: () => [{ frames: interrupted(modelOnly(), 12, 20) }] },
  { name: "tracking interruption mid starter", behaviour: "book", steps: () => [{ frames: interrupted(makeSign("PLEASE"), 10, 16) }] },
  { name: "reset (cancellation) mid model-only", behaviour: "book", steps: () => { const f = modelOnly(); return [{ frames: f.slice(0, 22) }, { input: { type: "reset" } }, { frames: f.slice(22) }]; } },
  { name: "language switch away and back", behaviour: "book", steps: () => [{ frames: modelOnly().slice(0, 22) }, { input: { type: "templates", language: "bsl", templates: [] } }, { input: { type: "templates", language: "asl", templates: [] } }, { frames: modelOnly(1700) }] },
  { name: "personal sign, model silent", behaviour: "silent", steps: () => [{ input: personalTemplate() }, { frames: modelOnly() }] },
  { name: "personal sign while the model also predicts", behaviour: "book", steps: () => [{ input: personalTemplate() }, { frames: modelOnly() }] },
  { name: "BSL model words become suggestions too", behaviour: "silent", bsl: true, steps: () => [{ input: { type: "templates", language: "bsl", templates: [] } }, { frames: modelOnly() }, { frames: modelOnly(1700) }] },
  ...Object.entries(NEGATIVE_CONTROLS).map(([name, make]) => ({ name: `negative control ${name}, model says BOOK`, behaviour: "book" as const, steps: () => [{ frames: make() }] })),
];

let delayed: { at: number; settle: () => void }[] = [];
let frameNo = 0;
function configure(behaviour: ModelBehaviour, bsl = false) {
  let call = 0;
  const value = (label: string, confidence = 0.97) => ({ label, text: label[0] + label.slice(1).toLowerCase(), confidence, margin: 0.6 });
  mocks.model.mockReset().mockImplementation(async () => {
    switch (behaviour) {
      case "silent": return null;
      case "book": return value("BOOK");
      case "echo-sign": return value(currentSign);
      case "disagree": return value(call++ % 2 ? "CHAIR" : "BOOK");
      case "low-confidence": return value("BOOK", 0.4);
      case "fails": throw new Error("model unavailable");
      case "slow-book": return new Promise(resolve => delayed.push({ at: frameNo + 4, settle: () => resolve(value("BOOK")) }));
    }
  });
  mocks.bsl.mockReset().mockImplementation(async () => bsl ? value("HOUSE") : null);
}

async function run(scenario: Scenario, workerModule: string) {
  vi.resetModules();
  delayed = []; frameNo = 0; currentSign = "BOOK";
  const steps = scenario.steps();
  configure(scenario.behaviour, scenario.bsl);
  const port: Port = { onmessage: async () => {}, postMessage: vi.fn() };
  vi.stubGlobal("self", port);
  installTemplateWorker();
  await import(workerModule);
  for (const step of steps) {
    if ("input" in step) { await port.onmessage({ data: step.input }); await new Promise<void>(r => setImmediate(r)); continue; }
    for (const frame of step.frames) {
      frameNo++;
      for (const d of delayed.filter(d => d.at <= frameNo)) d.settle();
      delayed = delayed.filter(d => d.at > frameNo);
      await port.onmessage({ data: { type: "frame", frame: structuredClone(frame) } });
      await new Promise<void>(r => setImmediate(r));
    }
  }
  // Wall-clock fields are not part of the decision.
  return port.postMessage.mock.calls.map(([m]) => { const { timestamp: _t, ...rest } = m as WorkerMessage & { timestamp?: number }; void _t; return rest; });
}

const ledger: Record<string, number> = { scenarios: 0, starterConfirmed: 0, personalConfirmed: 0,
  modelConfirmedBefore: 0, modelSuggestedAfter: 0, modelConfirmedAfter: 0, otherLanguageModelSuggestedAfter: 0, analysisMessages: 0 };

describe("model-output policy: only how research-model words are delivered changes, in every language", () => {
  it.each(SCENARIOS.map(s => [s.name, s] as const))("%s", async (_name, scenario) => {
    const before = await run(scenario, "./fixtures/recognition-worker-rc-baseline");
    const after = await run(scenario, "../workers/recognition.worker");
    // The baseline translated by the one rule the safeguard adds.
    const reference = before.map(message => message.type === "confirmed" && message.source === "model"
      ? { type: "suggested", session: message.session, language: scenario.bsl ? "bsl" : "asl", text: message.text, gloss: message.gloss, confidence: message.confidence, source: "model" }
      : message);
    const comparable = after.map(message => message.type === "suggested" ? (({ id: _id, ...rest }) => { void _id; return rest; })(message as WorkerMessage & { id: string }) : message);
    expect(comparable).toEqual(reference);

    ledger.scenarios++;
    for (const m of before) {
      if (m.type === "analysis") ledger.analysisMessages++;
      if (m.type === "confirmed" && m.source === "model") ledger.modelConfirmedBefore++;
    }
    for (const m of after) {
      if (m.type === "confirmed" && m.source === "starter") ledger.starterConfirmed++;
      if (m.type === "confirmed" && m.source === "personal") ledger.personalConfirmed++;
      if (m.type === "confirmed" && m.source === "model") ledger.modelConfirmedAfter++;
      if (m.type === "suggested") ledger.modelSuggestedAfter++;
      if (m.type === "suggested" && scenario.bsl) ledger.otherLanguageModelSuggestedAfter++;
    }
  });
  afterAll(() => {
    // The corpus must exercise every source, or the equivalence proves little.
    expect(ledger.modelConfirmedAfter).toBe(0);
    expect(ledger.modelSuggestedAfter).toBe(ledger.modelConfirmedBefore);
    expect(ledger.modelConfirmedBefore).toBeGreaterThan(0);
    expect(ledger.starterConfirmed).toBeGreaterThan(0);
    expect(ledger.personalConfirmed).toBeGreaterThan(0);
    expect(ledger.otherLanguageModelSuggestedAfter).toBeGreaterThan(0);
    mkdirSync("work", { recursive: true });
    writeFileSync("work/f1-equivalence-ledger.json", JSON.stringify(ledger, null, 1));
  });
});
