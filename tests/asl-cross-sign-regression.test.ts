import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkerInput, WorkerMessage } from "../lib/vision-types";
import { makeSign } from "./fixtures/asl-motion";
import { CONDITIONS, SIGNS, settle } from "./fixtures/asl-conditions";

// Cross-sign regression on synthetic kinematics: every change to a rule must
// keep each core word confirmed exactly once with no other label, across
// capture conditions. It is a regression net, not a measure of accuracy.
const mocks = vi.hoisted(() => ({ model: vi.fn() }));
vi.mock("../lib/asl1000-runtime", () => ({ recognizeAsl1000: mocks.model }));
let worker: { onmessage: (event: { data: WorkerInput }) => Promise<void>; postMessage: ReturnType<typeof vi.fn> };
beforeEach(async () => {
  vi.resetModules();
  mocks.model.mockReset().mockResolvedValue(null);
  worker = { onmessage: async () => {}, postMessage: vi.fn() };
  vi.stubGlobal("self", worker);
  await import("../workers/recognition.worker");
});
const cases = Object.entries(CONDITIONS).flatMap(([condition, make]) => SIGNS.map(sign => [condition, sign, make] as const));

describe("core ASL words across capture conditions", () => {
  it.each(cases)("%s: %s confirms exactly once with no other label", async (_condition, sign, make) => {
    for (const frame of settle(make(sign))) { await worker.onmessage({ data: { type: "frame", frame } }); await Promise.resolve(); }
    const words = worker.postMessage.mock.calls.map(([m]) => m as WorkerMessage).filter(m => m.type === "confirmed").map(m => (m as { gloss: string }).gloss);
    expect(words).toEqual([sign]);
  });
  it.each(["HELLO", "THANK YOU"] as const)("abstains on %s without any head reference (no face and no pose)", async sign => {
    for (const frame of settle(makeSign(sign).map(f => ({ ...f, face: [], pose: [] })))) {
      await worker.onmessage({ data: { type: "frame", frame } }); await Promise.resolve();
    }
    expect(worker.postMessage.mock.calls.filter(([m]) => m.type === "confirmed")).toEqual([]);
  });
});
