// Starter-rule false triggers on the synthetic everyday-movement inventory,
// through the real recognition worker with the research model silent (so every
// automatic word is a starter-rule word). Kinematic fixtures, not recordings.
//   RUN_STARTER_REPORT=1 npx vitest run tests/starter-false-trigger-report.test.ts
// writes work/starter-false-triggers.json (per sign x gesture x variation).
import { mkdirSync, writeFileSync } from "node:fs";
import { describe, it, vi } from "vitest";
import type { VisionFrame, WorkerInput, WorkerMessage } from "../lib/vision-types";
import { ADVERSARIAL_PATTERNS, VARIATIONS, vary, variationKey } from "./fixtures/asl-adversarial";
import { CONDITIONS, SIGNS, settle } from "./fixtures/asl-conditions";
import { NEGATIVE_CONTROLS } from "./fixtures/asl-negative-controls";

const mocks = vi.hoisted(() => ({ model: vi.fn(), options: {} as Record<string, boolean> }));
vi.mock("../lib/asl1000-runtime", () => ({ recognizeAsl1000: mocks.model }));
// Variant runs only: the worker's starter analysis with explicit rule options.
vi.mock("../lib/asl-starter-recognition", async importOriginal => {
  const actual = await importOriginal<typeof import("../lib/asl-starter-recognition")>();
  return { ...actual, analyzeAslStarter: (frames: VisionFrame[]) => actual.analyzeAslStarter(frames, mocks.options) };
});
export const VARIANTS: Record<string, Record<string, boolean>> = {
  baseline: {},
  thankYouForward: { thankYouForward: true },
  endAboveRest: { endAboveRest: true },
  helloFromForehead: { helloFromForehead: true },
  settledEnding: { settledEnding: true },
  "endAboveRest+thankYouForward": { endAboveRest: true, thankYouForward: true },
  "endAboveRest+settledEnding": { endAboveRest: true, settledEnding: true },
  all: { thankYouForward: true, endAboveRest: true, helloFromForehead: true, settledEnding: true },
};
type Port = { onmessage: (event: { data: WorkerInput }) => Promise<void>; postMessage: ReturnType<typeof vi.fn> };

async function worker(module = "../workers/recognition.worker") {
  vi.resetModules();
  const port: Port = { onmessage: async () => {}, postMessage: vi.fn() };
  vi.stubGlobal("self", port);
  await import(module);
  mocks.model.mockReset().mockResolvedValue(null);
  return async (frames: VisionFrame[]) => {
    port.postMessage.mockClear();
    await port.onmessage({ data: { type: "reset" } });
    for (const frame of frames) { await port.onmessage({ data: { type: "frame", frame } }); await Promise.resolve(); }
    return port.postMessage.mock.calls.map(([m]) => m as WorkerMessage).flatMap(m => m.type === "confirmed" ? [m.gloss] : []);
  };
}

describe("starter false-trigger inventory", () => {
  it.runIf(process.env.RUN_STARTER_VARIANTS === "1")("compares rule variants on the synthetic corpora", async () => {
    const out: Record<string, unknown> = {};
    for (const [name, options] of Object.entries(VARIANTS)) {
      mocks.options = options;
      const run = await worker();
      let everyday = 0, everydayTriggered = 0; const bySign: Record<string, number> = {};
      for (const patterns of Object.values(ADVERSARIAL_PATTERNS)) for (const make of Object.values(patterns)) for (const v of VARIATIONS) {
        const words = await run(vary(make(), v)); everyday++; if (words.length) everydayTriggered++; for (const w of words) bySign[w] = (bySign[w] ?? 0) + 1;
      }
      let negatives = 0; for (const make of Object.values(NEGATIVE_CONTROLS)) if ((await run(make())).length) negatives++;
      const recall: Record<string, number> = {};
      for (const sign of SIGNS) {
        let hit = 0;
        for (const make of Object.values(CONDITIONS)) if ((await run(settle(make(sign)))).includes(sign)) hit++;
        for (const v of VARIATIONS) if ((await run(settle(vary(CONDITIONS["15 fps"](sign), v)))).includes(sign)) hit++;
        recall[sign] = hit;
      }
      out[name] = { everyday_triggered: `${everydayTriggered}/${everyday}`, everyday_by_sign: bySign, negative_controls_triggered: `${negatives}/11`, positives_recalled_of_51: recall };
    }
    mkdirSync("work", { recursive: true });
    writeFileSync("work/starter-variants-synthetic.json", JSON.stringify(out, null, 1));
  }, 1800000);

  it.runIf(process.env.RUN_STARTER_REPORT === "1")("writes the per-sign, per-gesture, per-variation report", async () => {
    mocks.options = {};
    const run = await worker();
    const rows: { group: string; gesture: string; variation: string; words: string[] }[] = [];
    for (const [group, patterns] of Object.entries(ADVERSARIAL_PATTERNS)) for (const [gesture, make] of Object.entries(patterns))
      for (const v of VARIATIONS) rows.push({ group, gesture, variation: variationKey(v), words: await run(vary(make(), v)) });
    for (const [gesture, make] of Object.entries(NEGATIVE_CONTROLS)) rows.push({ group: "negative control", gesture, variation: "base", words: await run(make()) });
    const positives: { sign: string; take: string; words: string[] }[] = [];
    for (const sign of SIGNS) {
      for (const [name, make] of Object.entries(CONDITIONS)) positives.push({ sign, take: name, words: await run(settle(make(sign))) });
      for (const v of VARIATIONS) positives.push({ sign, take: variationKey(v), words: await run(settle(vary(CONDITIONS["15 fps"](sign), v))) });
    }
    const bySign: Record<string, Record<string, number>> = {};
    const byAxis: Record<string, Record<string, { takes: number; triggered: number }>> = {};
    for (const row of rows) {
      for (const word of row.words) ((bySign[word] ??= {})[`${row.group} / ${row.gesture}`] = (bySign[word]?.[`${row.group} / ${row.gesture}`] ?? 0) + 1);
      if (row.variation === "base") continue;
      const [side, speed, distance, degradation] = row.variation.split("/");
      for (const [axis, value] of [["side", side], ["speed", speed], ["distance", distance], ["degradation", degradation]]) {
        const cell = (byAxis[axis] ??= {})[value] ??= { takes: 0, triggered: 0 };
        cell.takes++; if (row.words.length) cell.triggered++;
      }
    }
    mkdirSync("work", { recursive: true });
    writeFileSync("work/starter-false-triggers.json", JSON.stringify({ takes: rows.length, triggered: rows.filter(r => r.words.length).length,
      bySign, byAxis, positives: { takes: positives.length, exact: positives.filter(p => p.words.length === 1 && p.words[0] === p.sign).length,
        missed: positives.filter(p => !p.words.includes(p.sign)).map(p => `${p.sign} ${p.take}`), extra: positives.filter(p => p.words.some(w => w !== p.sign)).map(p => `${p.sign} ${p.take}: ${p.words.join("+")}`) },
      rows }, null, 1));
  }, 900000);
});
