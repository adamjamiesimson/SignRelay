import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";
import { ASL_DEMO_WORDS } from "../lib/capability-status";
import type { WorkerInput, WorkerMessage } from "../lib/vision-types";
import { NEGATIVE_CONTROLS } from "./fixtures/asl-negative-controls";
import { schedule, source } from "./fixtures/capture-schedule";

// Evaluation only. The YES rule's stable ending must span >= 75 ms of samples
// (completedFistNod). True 15 fps capture intervals are 66.7 ms, so two still
// samples never qualify, while the pick-up clock stretches intervals to the
// tracking lane's busy time. This builds the REAL recognition worker with only
// that literal rewritten (nothing in the app changes), and compares windows
// under both clocks on the same synthetic schedules and negative controls.
// Synthetic kinematics: not evidence that any window helps real signers.
// RUN_YES_WINDOW_REPORT=1 writes SIGNRELAY_YES_WINDOW_REPORT.
const RULE = "lib/asl-starter-recognition.ts";
const LITERAL = "while (tail > 0 && last.time - samples[tail].time < 75) tail--;";

async function workerWithWindow(windowMs: number, dir: string) {
  const outfile = join(dir, `recognition-${windowMs}.mjs`);
  await build({ entryPoints: ["workers/recognition.worker.ts"], bundle: true, platform: "node", format: "esm", outfile, logLevel: "error",
    external: ["onnxruntime-web"],
    plugins: [{ name: "yes-window", setup(b) {
      b.onLoad({ filter: /asl-starter-recognition\.ts$/ }, () => {
        const text = readFileSync(RULE, "utf8");
        if (text.split(LITERAL).length !== 2) throw new Error("YES stable-ending literal not found exactly once");
        return { contents: text.replace(LITERAL, LITERAL.replace("< 75", `< ${windowMs}`)), loader: "ts" };
      });
      // Rules only, as in the throughput and clock experiments: the model abstains.
      b.onLoad({ filter: /asl1000-runtime\.ts$/ }, () => ({ contents: "export const recognizeAsl1000 = async () => null;", loader: "ts" }));
    } }] });
  const posted: WorkerMessage[] = [];
  const host = { onmessage: null as null | ((e: { data: WorkerInput }) => Promise<void>), postMessage: (m: WorkerMessage) => posted.push(m) };
  (globalThis as unknown as { self: unknown }).self = host;
  await import(pathToFileURL(outfile).href);
  const onmessage = host.onmessage!;
  return async (frames: { timestamp: number }[]) => {
    posted.length = 0;
    await onmessage({ data: { type: "reset" } });
    for (const frame of frames) { await onmessage({ data: { type: "frame", frame: frame as never } }); await Promise.resolve(); }
    const last = frames.at(-1)!.timestamp;
    for (let i = 1; i <= 10; i++) await onmessage({ data: { type: "frame", frame: { timestamp: last + i * 100, hands: [], face: [], pose: [] } } });
    return posted.filter(m => m.type === "confirmed").map(m => (m as { gloss: string }).gloss);
  };
}
const stamped = (picked: ReturnType<typeof schedule>, clock: "pickup-tick" | "capture-time") => {
  const offset = picked[0].tick - picked[0].capture;
  return picked.map(p => ({ ...p.frame, timestamp: clock === "pickup-tick" ? p.tick : p.capture + offset }));
};

describe("YES stable-ending window (evaluation only)", () => {
  it("rewrites exactly the production literal and leaves production at 75 ms", () => {
    const text = readFileSync(RULE, "utf8");
    expect(text.split(LITERAL).length).toBe(2);
  });
  it.runIf(process.env.RUN_YES_WINDOW_REPORT === "1")("writes the window comparison", async () => {
    const dir = mkdtempSync(join(tmpdir(), "signrelay-yes-window-"));
    const rows: object[] = [];
    try {
      for (const windowMs of [75, 67, 60, 50]) {
        const run = await workerWithWindow(windowMs, dir);
        const tally = { "pickup-tick": { YES: 0, total: 0 }, "capture-time": { YES: 0, total: 0 } };
        let differing = 0, unintended = 0;
        for (const cameraFps of [30, 15]) for (const trackingMs of [50, 80, 110, 150]) for (const rest of [250, 700]) for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
          const picked = schedule(source(ASL_DEMO_WORDS, rest), { cameraFps, trackingMs, seed });
          const words = { "pickup-tick": await run(stamped(picked, "pickup-tick")), "capture-time": await run(stamped(picked, "capture-time")) };
          if (words["pickup-tick"].join() !== words["capture-time"].join()) differing++;
          for (const [clock, list] of Object.entries(words) as [keyof typeof tally, string[]][]) {
            tally[clock].total += list.length; tally[clock].YES += list.filter(w => w === "YES").length;
            const positions = list.map(w => ASL_DEMO_WORDS.indexOf(w as typeof ASL_DEMO_WORDS[number]));
            if (positions.some(p => p < 0) || new Set(list).size !== list.length || positions.join() !== [...positions].sort((a, b) => a - b).join()) unintended++;
          }
        }
        const negatives = { "pickup-tick": 0, "capture-time": 0 };
        let cases = 0;
        for (const cameraFps of [30, 15]) for (const trackingMs of [50, 110]) for (const make of Object.values(NEGATIVE_CONTROLS)) for (const seed of [1, 2, 3]) {
          const frames = make().map(f => ({ ...f, timestamp: f.timestamp - 1000 }));
          const padded = [...frames, ...Array.from({ length: 30 }, (_, i) => ({ ...frames.at(-1)!, hands: [], timestamp: frames.at(-1)!.timestamp + (i + 1) * 10 }))];
          const picked = schedule(padded, { cameraFps, trackingMs, seed });
          cases++;
          for (const clock of ["pickup-tick", "capture-time"] as const) if ((await run(stamped(picked, clock))).length) negatives[clock]++;
        }
        rows.push({ windowMs, production: windowMs === 75, positiveRuns: 128, positiveConfirmations: tally, runsWithDifferentWordsBetweenClocks: differing,
          runsWithUnintendedOrderOrDuplicate: unintended, negativeCases: cases, negativeCasesWithAnyConfirmation: negatives });
        console.log("YES-WINDOW", JSON.stringify(rows.at(-1)));
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
    const out = process.env.SIGNRELAY_YES_WINDOW_REPORT ?? "work/yes-window.json";
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify({ schema: 1, status: "Synthetic kinematics through the real recognition worker with only the YES stable-ending literal rewritten; rules only (model abstains). Not recordings, not accuracy. Production remains 75 ms.", rows }, null, 2) + "\n");
  }, 900000);
});
