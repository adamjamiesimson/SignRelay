import { readFileSync, writeFileSync } from "node:fs";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { VisionFrame, WorkerInput, WorkerMessage } from "../lib/vision-types";
import { ADVERSARIAL_PATTERNS, VARIATIONS, vary } from "./fixtures/asl-adversarial";
import { CONDITIONS, SIGNS, settle } from "./fixtures/asl-conditions";

// Cross-sign confusion matrix over synthetic kinematics through the real
// worker: each intended sign under the 15 shared capture conditions and the 36
// adversarial capture variations, plus the 19 non-sign patterns as one row.
// Regenerate with UPDATE_CONFUSION=1. Not recordings and not accuracy.
const OUT = "docs/gitex/sprint-2/confusion-matrix";
const mocks = vi.hoisted(() => ({ model: vi.fn() }));
vi.mock("../lib/asl1000-runtime", () => ({ recognizeAsl1000: mocks.model }));
let worker: { onmessage: (event: { data: WorkerInput }) => Promise<void>; postMessage: ReturnType<typeof vi.fn> };
async function run(frames: VisionFrame[]) {
  worker.postMessage.mockClear();
  await worker.onmessage({ data: { type: "reset" } });
  for (const frame of frames) { await worker.onmessage({ data: { type: "frame", frame } }); await Promise.resolve(); }
  return worker.postMessage.mock.calls.map(([m]) => m as WorkerMessage).filter(m => m.type === "confirmed").map(m => (m as { gloss: string }).gloss);
}
const COLUMNS = [...SIGNS, "I LOVE YOU", "abstain", "more than one word"] as const;
const NON_SIGN = "non-sign movement";
type Matrix = Record<string, Record<string, number>>;
const matrices: Record<"rules" | "confidently_wrong_model", { matrix: Matrix; wrong: Record<string, string[]> }> = {
  rules: { matrix: {}, wrong: {} }, confidently_wrong_model: { matrix: {}, wrong: {} } };
function record(target: keyof typeof matrices, row: string, words: string[], label: string) {
  const { matrix, wrong } = matrices[target];
  matrix[row] ??= Object.fromEntries(COLUMNS.map(column => [column, 0]));
  const column = words.length === 0 ? "abstain" : words.length > 1 ? "more than one word" : words[0];
  matrix[row][column] = (matrix[row][column] ?? 0) + 1;
  if (column !== (row === NON_SIGN ? "abstain" : row)) (wrong[`${row} → ${column}`] ??= []).push(words.length > 1 ? `${label}: ${words.join(" + ")}` : label);
}
// A distractor for each sign: the closed-set model confidently reports the next core sign on every inference.
const distractor = (sign: string) => SIGNS[(SIGNS.indexOf(sign as typeof SIGNS[number]) + 1) % SIGNS.length];
beforeAll(async () => {
  mocks.model.mockResolvedValue(null);
  worker = { onmessage: async () => {}, postMessage: vi.fn() };
  vi.stubGlobal("self", worker);
  await import("../workers/recognition.worker");
  for (const target of ["rules", "confidently_wrong_model"] as const) {
    for (const sign of SIGNS) {
      mocks.model.mockResolvedValue(target === "rules" ? null : { label: distractor(sign), text: distractor(sign), confidence: 0.95, margin: 0.8 });
      for (const [condition, make] of Object.entries(CONDITIONS)) record(target, sign, await run(settle(make(sign))), condition);
      for (const variation of VARIATIONS) record(target, sign, await run(settle(vary(CONDITIONS["15 fps"](sign), variation))), `${variation.side}/x${variation.speed}/d${variation.distance}/${variation.degradation}`);
    }
    mocks.model.mockResolvedValue(target === "rules" ? null : { label: "PLEASE", text: "Please", confidence: 0.95, margin: 0.8 });
    for (const patterns of Object.values(ADVERSARIAL_PATTERNS)) for (const [name, make] of Object.entries(patterns))
      for (const variation of VARIATIONS) record(target, NON_SIGN, await run(vary(make(), variation)), name);
  }
}, 300000);

const table = (matrix: Matrix) => [`| Intended | ${COLUMNS.join(" | ")} |`, `| --- | ${COLUMNS.map(() => "---:").join(" | ")} |`,
  ...Object.entries(matrix).map(([row, counts]) => `| ${row} | ${COLUMNS.map(column => counts[column] ?? 0).join(" | ")} |`)];
const counted = (wrong: Record<string, string[]>) => Object.fromEntries(Object.entries(wrong).map(([cell, labels]) => [cell, labels.length]).sort());
function markdown() {
  const lines = ["# ASL cross-sign confusion matrix (synthetic)", "",
    "> Synthetic kinematic fixtures through the real recognition worker. Each sign row has 51 runs: 15 capture conditions plus 36 variations (mirrored hand, 3 speeds, 2 distances, clean/jitter/dropout). The non-sign row has 19 everyday movements × 36 variations. Not recordings and not an accuracy measurement. Regenerate with `UPDATE_CONFUSION=1 npx vitest run tests/asl-confusion-matrix.test.ts`.", "",
    "## Starter rules only (model returns nothing)", "", ...table(matrices.rules.matrix), "",
    "## With a confidently wrong closed-set model", "",
    "The model reports the next core sign (HELLO→NO, …, THANK YOU→HELLO) at 0.95 on every inference, or PLEASE for non-sign movements. This tests source arbitration, motion gating and two-evidence confirmation against a model that is always wrong.", "",
    ...table(matrices.confidently_wrong_model.matrix), "", "## Wrong outcomes", ""];
  for (const [name, { wrong }] of Object.entries(matrices)) for (const [cell, count] of Object.entries(counted(wrong))) lines.push(`- ${name}: ${cell}: ${count}`);
  return lines.join("\n") + "\n";
}

describe("cross-sign confusion matrix", () => {
  it("with the rules alone, no core sign is ever confirmed as a different sign or abstains", () => {
    for (const sign of SIGNS) expect(matrices.rules.matrix[sign][sign], JSON.stringify(matrices.rules.wrong)).toBe(51);
  });
  it("matches the committed matrices (regenerate with UPDATE_CONFUSION=1 and explain any change)", () => {
    const json = { schema: 1, status: "Synthetic kinematic fixtures; not recordings, not accuracy.", generated_by: "UPDATE_CONFUSION=1 npx vitest run tests/asl-confusion-matrix.test.ts",
      columns: COLUMNS, rules: { matrix: matrices.rules.matrix, wrong: counted(matrices.rules.wrong) },
      confidently_wrong_model: { matrix: matrices.confidently_wrong_model.matrix, wrong: counted(matrices.confidently_wrong_model.wrong),
        wrong_conditions: Object.fromEntries(Object.entries(matrices.confidently_wrong_model.wrong).filter(([cell]) => !cell.startsWith(NON_SIGN)).map(([cell, labels]) => [cell, labels]).sort()) } };
    if (process.env.UPDATE_CONFUSION === "1") { writeFileSync(`${OUT}.json`, JSON.stringify(json, null, 2) + "\n"); writeFileSync(`${OUT}.md`, markdown()); }
    expect(json).toEqual(JSON.parse(readFileSync(`${OUT}.json`, "utf8")));
    expect(readFileSync(`${OUT}.md`, "utf8")).toBe(markdown());
  });
});
