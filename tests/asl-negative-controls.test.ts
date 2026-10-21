import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VisionFrame, WorkerInput, WorkerMessage } from "../lib/vision-types";
import { NEGATIVE_CONTROLS } from "./fixtures/asl-negative-controls";

// Synthetic non-sign movements through the real worker with a confident
// closed-set model. Results are a regression record of known false-accept
// risks, not a measured false-acceptance rate for people.
const mocks = vi.hoisted(() => ({ model: vi.fn() }));
vi.mock("../lib/asl1000-runtime", () => ({ recognizeAsl1000: mocks.model }));
let worker: { onmessage: (event: { data: WorkerInput }) => Promise<void>; postMessage: ReturnType<typeof vi.fn> };
const confirmations = () => worker.postMessage.mock.calls.map(([m]) => m as WorkerMessage)
  .filter(m => m.type === "confirmed").map(m => `${(m as { gloss: string }).gloss}/${(m as { source?: string }).source}`);
async function feed(frames: VisionFrame[]) {
  for (const frame of frames) { await worker.onmessage({ data: { type: "frame", frame } }); await Promise.resolve(); }
}
beforeEach(async () => {
  vi.resetModules();
  mocks.model.mockReset().mockResolvedValue(null);
  worker = { onmessage: async () => {}, postMessage: vi.fn() };
  vi.stubGlobal("self", worker);
  await import("../workers/recognition.worker");
});

const known = JSON.parse(readFileSync("docs/gitex/known-false-accept-risks.json", "utf8")).synthetic_rule_outcomes as Record<string, string[]>;

describe("starter rules on synthetic everyday movements", () => {
  it.each(Object.keys(NEGATIVE_CONTROLS))("%s matches the documented outcome", async name => {
    await feed(NEGATIVE_CONTROLS[name]());
    expect(confirmations(), "update docs/gitex/known-false-accept-risks.json only with a reviewed reason").toEqual(known[name]);
  });
  it("documents every control", () => {
    expect(Object.keys(known).sort()).toEqual(Object.keys(NEGATIVE_CONTROLS).sort());
  });
});

describe("a confident closed-set model alone", () => {
  it.each(["hands resting at the chest", "scratching the chin", "small fist shake at the chest"])("does not emit a word for %s", async name => {
    mocks.model.mockResolvedValue({ label: "BOOK", text: "Book", confidence: 0.99, margin: 0.9 });
    await feed(NEGATIVE_CONTROLS[name]());
    expect(confirmations()).toEqual([]);
  });
});
