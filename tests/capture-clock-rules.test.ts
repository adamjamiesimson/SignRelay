import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { ASL_DEMO_WORDS } from "../lib/capability-status";
import type { VisionFrame, WorkerInput, WorkerMessage } from "../lib/vision-types";
import { schedule, source } from "./fixtures/capture-schedule";
import { NEGATIVE_CONTROLS } from "./fixtures/asl-negative-controls";

// Does the word pipeline behave differently when frames carry their camera
// capture time (this sprint) instead of the animation tick at which the
// tracking lane picked them up (before)? One simulated camera/tracker schedule
// delivers IDENTICAL frames in IDENTICAL order to the real recognition worker;
// only the timestamps differ. Rules only (model mocked to abstain), synthetic
// kinematics. Not recordings, not accuracy, not a device measurement.
// RUN_CAPTURE_CLOCK_REPORT=1 writes SIGNRELAY_CAPTURE_CLOCK_REPORT.
const mocks = vi.hoisted(() => ({ model: vi.fn() }));
vi.mock("../lib/asl1000-runtime", () => ({ recognizeAsl1000: mocks.model }));
let worker: { onmessage: (event: { data: WorkerInput }) => Promise<void>; postMessage: ReturnType<typeof vi.fn> };
beforeAll(async () => {
  mocks.model.mockResolvedValue(null);
  worker = { onmessage: async () => {}, postMessage: vi.fn() };
  vi.stubGlobal("self", worker);
  await import("../workers/recognition.worker");
});
async function run(picked: ReturnType<typeof schedule>, clock: "pickup-tick" | "capture-time") {
  worker.postMessage.mockClear();
  await worker.onmessage({ data: { type: "reset" } });
  const offset = picked[0].tick - picked[0].capture;
  for (const item of picked) {
    const timestamp = clock === "pickup-tick" ? item.tick : item.capture + offset;
    await worker.onmessage({ data: { type: "frame", frame: { ...item.frame, timestamp } } });
    await Promise.resolve();
  }
  const last = picked.at(-1)!.tick;
  for (let i = 1; i <= 10; i++) await worker.onmessage({ data: { type: "frame", frame: { timestamp: last + i * 100, hands: [], face: [], pose: [] } } });
  const messages = worker.postMessage.mock.calls.map(([m]) => m as WorkerMessage);
  return messages.filter(m => m.type === "confirmed").map(m => (m as { gloss: string }).gloss);
}

describe("word rules under the capture clock and the pick-up clock", () => {
  it("delivers the same frames in the same order; only the clock differs", () => {
    const picked = schedule(source(["THANK YOU"], 250), { cameraFps: 15, trackingMs: 110, seed: 3 });
    const capture = picked.map(p => p.capture), ticks = picked.map(p => p.tick);
    // Capture intervals are camera multiples; pick-up intervals are not.
    expect(capture.slice(1).every((t, i) => Math.abs(((t - capture[i]) / (1000 / 15)) - Math.round((t - capture[i]) / (1000 / 15))) < 1e-6)).toBe(true);
    expect(ticks.slice(1).some((t, i) => Math.abs(((t - ticks[i]) / (1000 / 15)) - Math.round((t - ticks[i]) / (1000 / 15))) > 0.1)).toBe(true);
  });
  it("keeps the confirmation invariant under both clocks: intended words only, in order, no duplicates", async () => {
    const signs = ASL_DEMO_WORDS;
    for (const clock of ["pickup-tick", "capture-time"] as const) for (const trackingMs of [50, 110]) for (const seed of [1, 2]) {
      const words = await run(schedule(source(signs, 250), { cameraFps: 30, trackingMs, seed }), clock);
      const positions = words.map(word => signs.indexOf(word as typeof signs[number]));
      expect(positions.every(p => p >= 0), `${clock} ${trackingMs}: ${words}`).toBe(true);
      expect(positions).toEqual([...positions].sort((a, b) => a - b));
      expect(new Set(words).size).toBe(words.length);
    }
  });
  it.runIf(process.env.RUN_CAPTURE_CLOCK_REPORT === "1")("writes the matched capture-clock record", async () => {
    const rows: object[] = [];
    const seeds = [1, 2, 3, 4, 5, 6, 7, 8];
    for (const cameraFps of [30, 15]) for (const trackingMs of [50, 80, 110, 150]) for (const rest of [250, 700]) {
      const tally = { "pickup-tick": {} as Record<string, number>, "capture-time": {} as Record<string, number> };
      let disagreements = 0;
      for (const seed of seeds) {
        const picked = schedule(source(ASL_DEMO_WORDS, rest), { cameraFps, trackingMs, seed });
        const a = await run(picked, "pickup-tick"), b = await run(picked, "capture-time");
        if (a.join() !== b.join()) disagreements++;
        for (const word of a) tally["pickup-tick"][word] = (tally["pickup-tick"][word] ?? 0) + 1;
        for (const word of b) tally["capture-time"][word] = (tally["capture-time"][word] ?? 0) + 1;
      }
      // How often consecutive tracked frames are under the YES rule's 75 ms
      // stable-ending window. The pick-up clock stretches every interval to the
      // lane's busy time, so two samples can "span" 75 ms that were not observed.
      const below = { "pickup-tick": 0, "capture-time": 0 }; let intervals = 0;
      for (const seed of seeds) {
        const picked = schedule(source(ASL_DEMO_WORDS, rest), { cameraFps, trackingMs, seed });
        for (let k = 1; k < picked.length; k++) {
          intervals++;
          if (picked[k].tick - picked[k - 1].tick < 75) below["pickup-tick"]++;
          if (picked[k].capture - picked[k - 1].capture < 75) below["capture-time"]++;
        }
      }
      rows.push({ kind: "positive six-word sequence", cameraFps, trackingMeanMs: trackingMs, restMs: rest, runs: seeds.length, confirmations: tally, runsWithDifferentWords: disagreements,
        intervalsBelow75Ms: { intervals, "pickup-tick": below["pickup-tick"], "capture-time": below["capture-time"] } });
    }
    for (const cameraFps of [30, 15]) for (const trackingMs of [50, 110]) {
      const triggers = { "pickup-tick": 0, "capture-time": 0 } as Record<string, number>;
      const words = { "pickup-tick": [] as string[], "capture-time": [] as string[] } as Record<string, string[]>;
      let cases = 0;
      for (const [name, make] of Object.entries(NEGATIVE_CONTROLS)) for (const seed of [1, 2, 3]) {
        const frames = make().map(frame => ({ ...frame, timestamp: frame.timestamp - 1000 }));
        const padded = [...frames, ...Array.from({ length: 30 }, (_, i) => ({ ...frames.at(-1)!, hands: [], timestamp: frames.at(-1)!.timestamp + (i + 1) * 10 }))];
        const picked = schedule(padded, { cameraFps, trackingMs, seed });
        cases++;
        for (const clock of ["pickup-tick", "capture-time"] as const) {
          const confirmed = await run(picked, clock);
          if (confirmed.length) { triggers[clock]++; words[clock].push(`${name}: ${confirmed.join("+")}`); }
        }
      }
      rows.push({ kind: "synthetic everyday-movement controls", cameraFps, trackingMeanMs: trackingMs, cases, casesWithAnyConfirmation: triggers, examples: words });
    }
    const out = process.env.SIGNRELAY_CAPTURE_CLOCK_REPORT ?? "work/capture-clock-rules.json";
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify({ schema: 1,
      status: "Synthetic kinematics through the real recognition worker, rules only (model abstains). Same frames and order under both clocks. Not recordings, not accuracy, not a device measurement.",
      method: "tests/capture-clock-rules.test.ts: 10 ms synthetic source, sample-and-hold camera at cameraFps with random phase, 20 ms presentation latency, 60 Hz loop with 33 ms minimum spacing, tracking lane busy trackingMeanMs ±30%",
      rows }, null, 2) + "\n");
  }, 600000);
});
