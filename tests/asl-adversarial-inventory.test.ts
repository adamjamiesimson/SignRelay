import { readFileSync, writeFileSync } from "node:fs";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { VisionFrame, WorkerInput, WorkerMessage } from "../lib/vision-types";
import { ADVERSARIAL_PATTERNS, VARIATION_AXES, VARIATIONS, vary, variationKey } from "./fixtures/asl-adversarial";

// Every adversarial pattern under every capture variation, through the real
// recognition worker (the closed-set model returns nothing, so this measures
// the starter rules and arbitration). The committed inventory is a regression
// record: any change in a synthetic false accept must be regenerated
// (UPDATE_ADVERSARIAL=1) and explained in docs/gitex/known-false-accept-risks.json.
const INVENTORY = "docs/gitex/adversarial-inventory.json";
const mocks = vi.hoisted(() => ({ model: vi.fn() }));
vi.mock("../lib/asl1000-runtime", () => ({ recognizeAsl1000: mocks.model }));
let worker: { onmessage: (event: { data: WorkerInput }) => Promise<void>; postMessage: ReturnType<typeof vi.fn> };
async function run(frames: VisionFrame[]) {
  worker.postMessage.mockClear();
  await worker.onmessage({ data: { type: "reset" } });
  for (const frame of frames) { await worker.onmessage({ data: { type: "frame", frame } }); await Promise.resolve(); }
  return worker.postMessage.mock.calls.map(([m]) => m as WorkerMessage)
    .filter(m => m.type === "confirmed").map(m => `${(m as { gloss: string }).gloss}/${(m as { source?: string }).source}`);
}

type Outcome = { variations: number; runs_with_accept: number; accepted: Record<string, number>; accepting_variations: string[] };
const results: Record<string, Record<string, Outcome>> = {};
beforeAll(async () => {
  mocks.model.mockResolvedValue(null);
  worker = { onmessage: async () => {}, postMessage: vi.fn() };
  vi.stubGlobal("self", worker);
  await import("../workers/recognition.worker");
  for (const [category, patterns] of Object.entries(ADVERSARIAL_PATTERNS)) {
    results[category] = {};
    for (const [name, make] of Object.entries(patterns)) {
      const outcome: Outcome = { variations: 0, runs_with_accept: 0, accepted: {}, accepting_variations: [] };
      for (const variation of VARIATIONS) {
        const accepted = await run(vary(make(), variation));
        outcome.variations++;
        if (accepted.length) { outcome.runs_with_accept++; outcome.accepting_variations.push(variationKey(variation)); }
        for (const gloss of accepted) outcome.accepted[gloss] = (outcome.accepted[gloss] ?? 0) + 1;
      }
      results[category][name] = outcome;
    }
  }
}, 120000);

function inventory() {
  const all = Object.values(results).flatMap(patterns => Object.values(patterns));
  const byGloss: Record<string, number> = {};
  for (const outcome of all) for (const [gloss, count] of Object.entries(outcome.accepted)) byGloss[gloss] = (byGloss[gloss] ?? 0) + count;
  return {
    schema: 1,
    status: "Synthetic kinematic stand-ins through the real recognition worker with no model output. Not recordings of people, not reviewed negatives, and not a false-acceptance rate. Real no-sign false acceptance is NOT MEASURED.",
    generated_by: "UPDATE_ADVERSARIAL=1 npx vitest run tests/asl-adversarial-inventory.test.ts",
    variation_axes: VARIATION_AXES,
    variations_per_pattern: VARIATIONS.length,
    totals: { patterns: all.length, runs: all.reduce((sum, o) => sum + o.variations, 0), runs_with_accept: all.reduce((sum, o) => sum + o.runs_with_accept, 0), accepted_by_gloss: byGloss },
    categories: results,
  };
}

describe("adversarial non-sign inventory", () => {
  it("covers glasses, hair, face touching, salutes, fist lifting, conversation and hand-to-mouth with every variation", () => {
    expect(Object.keys(ADVERSARIAL_PATTERNS).sort()).toEqual(["accidental salute", "conversation", "face touching", "fist lifting", "glasses", "hair", "hand to mouth"]);
    expect(VARIATIONS).toHaveLength(36);
    for (const patterns of Object.values(results)) for (const outcome of Object.values(patterns)) expect(outcome.variations).toBe(36);
  });
  it("matches the committed inventory exactly (regenerate and explain any change)", () => {
    const current = inventory();
    if (process.env.UPDATE_ADVERSARIAL === "1") writeFileSync(INVENTORY, JSON.stringify(current, null, 2) + "\n");
    expect(current).toEqual(JSON.parse(readFileSync(INVENTORY, "utf8")));
  });
  it("every pattern that ever produces a word has a documented explanation", () => {
    const explained = JSON.parse(readFileSync(INVENTORY.replace("adversarial-inventory", "known-false-accept-risks"), "utf8")).adversarial_explanations ?? {};
    const accepting = Object.values(results).flatMap(patterns => Object.entries(patterns)).filter(([, o]) => o.runs_with_accept).map(([name]) => name);
    expect(accepting.filter(name => !explained[name])).toEqual([]);
  });
});
