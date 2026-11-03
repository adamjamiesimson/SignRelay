// F1 synthetic before/after: what enters the transcript AUTOMATICALLY with the
// release-candidate worker (frozen fixture) versus the F1 worker, over the
// existing synthetic corpora (kinematic fixtures, not recordings, not accuracy).
//   RUN_F1_REPORT=1 npx vitest run tests/f1-synthetic-before-after.test.ts
// rewrites docs/release-candidate/f1-synthetic-before-after.json; the always-on
// test checks the committed report's invariants.
import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { VisionFrame, WorkerInput, WorkerMessage } from "../lib/vision-types";
import { ADVERSARIAL_PATTERNS, VARIATIONS, vary } from "./fixtures/asl-adversarial";
import { CONDITIONS, SIGNS, settle } from "./fixtures/asl-conditions";
import { NEGATIVE_CONTROLS } from "./fixtures/asl-negative-controls";

const OUT = "docs/release-candidate/f1-synthetic-before-after.json";
const mocks = vi.hoisted(() => ({ model: vi.fn() }));
vi.mock("../lib/asl1000-runtime", () => ({ recognizeAsl1000: mocks.model }));
type Port = { onmessage: (event: { data: WorkerInput }) => Promise<void>; postMessage: ReturnType<typeof vi.fn> };
type Model = "silent" | "confidently-wrong" | "agrees";
type Take = { corpus: string; target: string | null; frames: VisionFrame[] };

const word = (label: string) => ({ label, text: label, confidence: 0.95, margin: 0.8 });
const distractor = (sign: string) => SIGNS[(SIGNS.indexOf(sign as typeof SIGNS[number]) + 1) % SIGNS.length];
function takes(): Take[] {
  const out: Take[] = [];
  for (const sign of SIGNS) {
    for (const make of Object.values(CONDITIONS)) out.push({ corpus: "starter signs, every condition", target: sign, frames: settle(make(sign)) });
    for (const v of VARIATIONS) out.push({ corpus: "starter signs, 36 capture variations", target: sign, frames: settle(vary(CONDITIONS["15 fps"](sign), v)) });
  }
  for (const patterns of Object.values(ADVERSARIAL_PATTERNS)) for (const make of Object.values(patterns)) for (const v of VARIATIONS)
    out.push({ corpus: "everyday non-sign movements x 36 variations", target: null, frames: vary(make(), v) });
  for (const make of Object.values(NEGATIVE_CONTROLS)) out.push({ corpus: "negative controls", target: null, frames: make() });
  return out;
}
function modelFor(model: Model, take: Take) {
  if (model === "silent") return null;
  if (model === "agrees") return take.target ? word(take.target) : word("PLEASE");
  return word(take.target ? distractor(take.target) : "PLEASE");
}

async function runAll(workerModule: string, model: Model, corpus: Take[]) {
  vi.resetModules();
  const port: Port = { onmessage: async () => {}, postMessage: vi.fn() };
  vi.stubGlobal("self", port);
  await import(workerModule);
  const results: { take: Take; confirmed: { gloss: string; source?: string }[]; suggested: string[] }[] = [];
  for (const take of corpus) {
    mocks.model.mockReset().mockImplementation(async () => modelFor(model, take));
    port.postMessage.mockClear();
    await port.onmessage({ data: { type: "reset" } });
    for (const frame of take.frames) { await port.onmessage({ data: { type: "frame", frame } }); await Promise.resolve(); }
    const messages = port.postMessage.mock.calls.map(([m]) => m as WorkerMessage);
    results.push({ take, confirmed: messages.flatMap(m => m.type === "confirmed" ? [{ gloss: m.gloss, source: m.source }] : []),
      suggested: messages.flatMap(m => m.type === "suggested" ? [m.gloss] : []) });
  }
  return results;
}
function tally(results: Awaited<ReturnType<typeof runAll>>) {
  const by: Record<string, Record<string, number>> = {};
  for (const { take, confirmed, suggested } of results) {
    const t = by[take.corpus] ??= { takes: 0, auto_correct: 0, auto_false: 0, auto_false_from_model: 0, auto_from_model: 0,
      takes_with_correct_auto_word: 0, takes_with_false_auto_word: 0, abstained_no_auto_word: 0, suggestions: 0, suggestions_correct: 0 };
    t.takes++;
    for (const c of confirmed) {
      if (c.source === "model") t.auto_from_model++;
      if (take.target && c.gloss === take.target) t.auto_correct++;
      else { t.auto_false++; if (c.source === "model") t.auto_false_from_model++; }
    }
    if (take.target && confirmed.some(c => c.gloss === take.target)) t.takes_with_correct_auto_word++;
    if (confirmed.some(c => c.gloss !== take.target)) t.takes_with_false_auto_word++;
    if (!confirmed.length) t.abstained_no_auto_word++;
    t.suggestions += suggested.length;
    t.suggestions_correct += suggested.filter(g => g === take.target).length;
  }
  return by;
}

describe("F1 synthetic before/after (automatic transcript words)", () => {
  it.runIf(process.env.RUN_F1_REPORT === "1")("regenerates the committed report", async () => {
    const corpus = takes();
    const report: Record<string, unknown> = {
      kind: "Synthetic kinematic fixtures through the real recognition worker with a mocked ASL-2000 model; automatic transcript words only. Not recordings, not accuracy.",
      generated_by: "RUN_F1_REPORT=1 npx vitest run tests/f1-synthetic-before-after.test.ts", takes: corpus.length, models: {} };
    for (const model of ["silent", "confidently-wrong", "agrees"] as const) {
      (report.models as Record<string, unknown>)[model] = {
        before_rc_1e53d61: tally(await runAll("./fixtures/recognition-worker-rc-baseline", model, corpus)),
        after_f1: tally(await runAll("../workers/recognition.worker", model, corpus)),
      };
    }
    writeFileSync(OUT, JSON.stringify(report, null, 1) + "\n");
  }, 900000);

  it("committed report: no automatic ASL model word after F1; starter-rule words unchanged; model words become suggestions", () => {
    const report = JSON.parse(readFileSync(OUT, "utf8")) as { models: Record<string, { before_rc_1e53d61: Record<string, Record<string, number>>; after_f1: Record<string, Record<string, number>> }> };
    for (const [model, { before_rc_1e53d61: before, after_f1: after }] of Object.entries(report.models)) {
      for (const corpus of Object.keys(before)) {
        const b = before[corpus], a = after[corpus];
        expect(a.auto_from_model, `${model} ${corpus}`).toBe(0);
        // Starter-rule outcomes are untouched: correct automatic words are identical.
        expect(a.auto_correct + 0, `${model} ${corpus}`).toBe(b.auto_correct - (b.auto_from_model - b.auto_false_from_model));
        expect(a.auto_false, `${model} ${corpus}`).toBe(b.auto_false - b.auto_false_from_model);
        expect(a.suggestions, `${model} ${corpus}`).toBe(b.auto_from_model);
      }
    }
  });
});
