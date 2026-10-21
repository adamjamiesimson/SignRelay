import { readFileSync, writeFileSync } from "node:fs";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { VisionFrame, WorkerInput, WorkerMessage } from "../lib/vision-types";
import { ADVERSARIAL_PATTERNS, VARIATIONS, vary } from "./fixtures/asl-adversarial";
import { CONDITIONS, SIGNS, settle } from "./fixtures/asl-conditions";
import { makeSign } from "./fixtures/asl-motion";
import { trajectory } from "./fixtures/asl-negative-controls";

// Experiments run through the real recognition worker by swapping the starter
// analyzer for analyzeWithExperiments. Production never imports the
// experiments module. The full comparison (RUN_EXPERIMENTS=1) rewrites
// docs/gitex/sprint-2/experiments.json; the default run checks isolation,
// default-off behaviour and the committed comparison's targeted outcomes.
const hook = vi.hoisted(() => ({ analyze: null as null | ((frames: VisionFrame[]) => unknown), model: vi.fn() }));
vi.mock("../lib/asl1000-runtime", () => ({ recognizeAsl1000: hook.model }));
vi.mock("../lib/asl-starter-recognition", async importOriginal => {
  const actual = await importOriginal<typeof import("../lib/asl-starter-recognition")>();
  return { ...actual, actualAnalyze: actual.analyzeAslStarter,
    analyzeAslStarter: (frames: VisionFrame[]) => (hook.analyze ?? actual.analyzeAslStarter)(frames) };
});
const { EXPERIMENTS, analyzeWithExperiments, fillHandGaps } = await import("../lib/asl-starter-experiments");
type ExperimentId = keyof typeof EXPERIMENTS;
const actualAnalyze = ((await import("../lib/asl-starter-recognition")) as unknown as { actualAnalyze: NonNullable<Parameters<typeof analyzeWithExperiments>[2]> }).actualAnalyze;

let worker: { onmessage: (event: { data: WorkerInput }) => Promise<void>; postMessage: ReturnType<typeof vi.fn> };
async function run(frames: VisionFrame[], enabled: readonly ExperimentId[]) {
  hook.analyze = sequence => analyzeWithExperiments(sequence, enabled, actualAnalyze);
  worker.postMessage.mockClear();
  await worker.onmessage({ data: { type: "reset" } });
  for (const frame of frames) { await worker.onmessage({ data: { type: "frame", frame } }); await Promise.resolve(); }
  return worker.postMessage.mock.calls.map(([m]) => m as WorkerMessage).filter(m => m.type === "confirmed").map(m => (m as { gloss: string }).gloss);
}
beforeAll(async () => {
  hook.model.mockResolvedValue(null);
  worker = { onmessage: async () => {}, postMessage: vi.fn() };
  vi.stubGlobal("self", worker);
  await import("../workers/recognition.worker");
});

/** Seeded loss so sparse-tracking simulations are reproducible. */
const seeded = (seed: number) => () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
export const SPARSE: Record<string, (count: number) => VisionFrame[]> = {
  "every 2nd hand frame lost": count => makeSign("YES", { count }).map((f, i) => i % 2 ? { ...f, hands: [] } : f),
  "every 3rd hand frame lost": count => makeSign("YES", { count }).map((f, i) => i % 3 === 1 ? { ...f, hands: [] } : f),
  "2-frame bursts every 5": count => makeSign("YES", { count }).map((f, i) => i % 5 === 1 || i % 5 === 2 ? { ...f, hands: [] } : f),
  ...Object.fromEntries([20, 35, 50].flatMap(rate => [1, 2, 3].map(seed => [`${rate}% random loss (seed ${seed})`, (count: number) => {
    const random = seeded(seed * 7919 + rate);
    return makeSign("YES", { count }).map((f, i) => i && i < count - 1 && random() < rate / 100 ? { ...f, hands: [] } : f);
  }]))),
};
const SPARSE_COUNTS = [14, 21, 28];

/** THANK YOU vs PLEASE edge cases for thank-you-over-incomplete-please: the
 * expected word, or null where abstaining is the only safe outcome. */
const arc = (from: number, to: number, steps: number) => Array.from({ length: steps + 1 }, (_, i) => from + (to - from) * i / steps);
export const OPEN_PALM_EDGES: Record<string, { expected: string | null; make: (speed: number) => VisionFrame[] }> = {
  "THANK YOU after a partial chest arc": { expected: "THANK YOU", make: speed => trajectory([
    ...arc(0, Math.PI, 6).map((angle, i) => ({ t: i * 0.06, x: 0.5 + 0.06 * Math.cos(angle), y: 0.68 + 0.06 * Math.sin(angle) })),
    { t: 0.5, x: 0.53, y: 0.5 }, { t: 0.62, x: 0.53, y: 0.5 }, { t: 1, x: 0.64, y: 0.64 }], { duration: 2200 / speed }) },
  "incomplete PLEASE circle then an outward sweep": { expected: null, make: speed => trajectory([
    ...arc(0, 1.5 * Math.PI, 8).map((angle, i) => ({ t: i * 0.07, x: 0.5 + 0.06 * Math.cos(angle), y: 0.65 + 0.06 * Math.sin(angle) })),
    { t: 1, x: 0.72, y: 0.6 }], { duration: 1600 / speed }) },
  "PLEASE circle ending near the mouth": { expected: "PLEASE", make: speed => trajectory([
    ...arc(0, 2 * Math.PI, 10).map((angle, i) => ({ t: i * 0.07, x: 0.5 + 0.06 * Math.cos(angle), y: 0.65 + 0.06 * Math.sin(angle) })),
    { t: 1, x: 0.53, y: 0.52 }], { duration: 1800 / speed }) },
};

const CONFIGS: Record<string, readonly ExperimentId[]> = {
  baseline: [], ...Object.fromEntries(Object.keys(EXPERIMENTS).map(id => [id, [id as ExperimentId]])),
  "all experiments": Object.keys(EXPERIMENTS) as ExperimentId[],
};

async function evaluate(enabled: readonly ExperimentId[]) {
  const positives = { runs: 0, correct: 0, wrong: {} as Record<string, number>, missed: [] as string[] };
  for (const [condition, make] of Object.entries(CONDITIONS)) for (const sign of SIGNS) {
    const words = await run(settle(make(sign)), enabled);
    positives.runs++;
    if (words.length === 1 && words[0] === sign) positives.correct++;
    else if (!words.length) positives.missed.push(`${sign} @ ${condition}`);
    for (const word of words.filter(word => word !== sign)) positives.wrong[`${sign}→${word}`] = (positives.wrong[`${sign}→${word}`] ?? 0) + 1;
  }
  const sparse = { runs: 0, yes: 0, other: {} as Record<string, number>, by_pattern: {} as Record<string, number> };
  for (const [pattern, make] of Object.entries(SPARSE)) for (const count of SPARSE_COUNTS) {
    const words = await run(settle(make(count)), enabled);
    sparse.runs++;
    if (words.includes("YES")) { sparse.yes++; sparse.by_pattern[pattern] = (sparse.by_pattern[pattern] ?? 0) + 1; }
    for (const word of words.filter(word => word !== "YES")) sparse.other[word] = (sparse.other[word] ?? 0) + 1;
  }
  const negatives = { runs: 0, runs_with_accept: 0, by_gloss: {} as Record<string, number>, by_pattern: {} as Record<string, number> };
  for (const patterns of Object.values(ADVERSARIAL_PATTERNS)) for (const [name, make] of Object.entries(patterns)) for (const variation of VARIATIONS) {
    const words = await run(vary(make(), variation), enabled);
    negatives.runs++;
    if (words.length) { negatives.runs_with_accept++; negatives.by_pattern[name] = (negatives.by_pattern[name] ?? 0) + 1; }
    for (const word of words) negatives.by_gloss[word] = (negatives.by_gloss[word] ?? 0) + 1;
  }
  const edges: Record<string, { expected: string | null; outcomes: Record<string, number> }> = {};
  for (const [name, edge] of Object.entries(OPEN_PALM_EDGES)) {
    edges[name] = { expected: edge.expected, outcomes: {} };
    for (const speed of [0.7, 1, 1.4]) for (const variation of VARIATIONS.filter(v => v.speed === 1)) {
      const key = (await run(vary(edge.make(speed), variation), enabled)).join("+") || "abstain";
      edges[name].outcomes[key] = (edges[name].outcomes[key] ?? 0) + 1;
    }
  }
  return { positives, sparse_yes: sparse, adversarial: negatives, open_palm_edges: edges };
}

const RESULTS = "docs/gitex/sprint-2/experiments.json";
describe.runIf(process.env.RUN_EXPERIMENTS === "1")("full experiment comparison", () => {
  it("compares every experiment with the baseline on positives, sparse YES and adversarial movements", async () => {
    const results: Record<string, unknown> = {};
    for (const [name, enabled] of Object.entries(CONFIGS)) results[name] = await evaluate(enabled);
    writeFileSync(RESULTS, JSON.stringify({ schema: 1,
      status: "Synthetic kinematic fixtures through the real worker. Not recordings, not real-video evidence, not accuracy. Every experiment is OFF in production.",
      generated_by: "RUN_EXPERIMENTS=1 npx vitest run tests/asl-experiments.test.ts",
      experiments: EXPERIMENTS, positive_runs: "6 signs x 15 capture conditions", sparse_yes_runs: `${Object.keys(SPARSE).length} loss patterns x ${SPARSE_COUNTS.length} frame rates`,
      adversarial_runs: "19 patterns x 36 variations", open_palm_edge_runs: "3 cases x 3 speeds x 12 variations", results }, null, 2) + "\n");
  }, 600000);
});

describe("ASL experiment switches", () => {
  it("are isolated from production: neither the worker nor the app imports them", () => {
    for (const file of ["workers/recognition.worker.ts", "lib/asl-starter-recognition.ts", "components/translator-experience.tsx"])
      expect(readFileSync(file, "utf8")).not.toContain("asl-starter-experiments");
    const bundle = readFileSync("public/workers/recognition.worker.js", "utf8");
    for (const id of Object.keys(EXPERIMENTS)) expect(bundle).not.toContain(id);
  });
  it("with no experiment enabled the analyzer is exactly the production analyzer", () => {
    for (const sign of SIGNS) for (const make of Object.values(CONDITIONS)) {
      const frames = settle(make(sign));
      for (let end = 5; end <= frames.length; end += 3)
        expect(analyzeWithExperiments(frames.slice(0, end), [], actualAnalyze)).toEqual(actualAnalyze(frames.slice(0, end)));
    }
  });
  it("gap filling never invents a hand after the newest observation or across long gaps", () => {
    const frames = makeSign("YES", { count: 10 }).map((f, i) => i >= 8 ? { ...f, hands: [] } : f);
    const filled = fillHandGaps(frames);
    expect(filled.slice(8).every(f => f.hands.length === 0)).toBe(true);
    const long = makeSign("YES", { count: 10 }).map((f, i) => i >= 2 && i <= 5 ? { ...f, hands: [] } : f);
    expect(fillHandGaps(long).slice(2, 6).every(f => f.hands.length === 0)).toBe(true);
  });
  it("targeted outcomes match the committed comparison", async () => {
    const committed = JSON.parse(readFileSync(RESULTS, "utf8")).results;
    // Re-run one targeted adversarial pattern per veto, both off and on, and compare with the committed full run.
    const count = async (name: string, enabled: readonly ExperimentId[]) => {
      let accepted = 0;
      for (const patterns of Object.values(ADVERSARIAL_PATTERNS)) if (patterns[name]) for (const variation of VARIATIONS)
        if ((await run(vary(patterns[name](), variation), enabled)).length) accepted++;
      return accepted;
    };
    for (const [id, pattern] of [["hello-sideways-stroke", "waving to someone across the room"], ["thank-you-not-from-eyes", "adjusting glasses"]] as const) {
      expect(await count(pattern, [])).toBe(committed.baseline.adversarial.by_pattern[pattern] ?? 0);
      expect(await count(pattern, [id])).toBe(committed[id].adversarial.by_pattern[pattern] ?? 0);
    }
  }, 60000);
});
