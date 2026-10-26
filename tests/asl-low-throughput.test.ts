import { writeFileSync } from "node:fs";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { ASL_DEMO_WORDS } from "../lib/capability-status";
import { RehearsalScript } from "../lib/rehearsal";
import type { VisionFrame, WorkerInput, WorkerMessage } from "../lib/vision-types";
import { makeSign, type Sign } from "./fixtures/asl-motion";

// Sprint 5 objective 08: why the rehearsal smoke sometimes lost THANK YOU.
// The scripted sequence is replayed exactly as the rehearsal build does
// (RehearsalScript.next against the frame loop's clock, previous frame held
// until the next is due), and the frame loop's delivery interval is varied as
// CPU load varies it. Rules only, with the model mocked to abstain, as in the
// six-word demo. Synthetic kinematics; not a recording or an accuracy figure.
// RUN_LOW_THROUGHPUT_REPORT=1 writes docs/refinement/sprint-5/low-throughput.json.
const mocks = vi.hoisted(() => ({ model: vi.fn() }));
vi.mock("../lib/asl1000-runtime", () => ({ recognizeAsl1000: mocks.model }));
let worker: { onmessage: (event: { data: WorkerInput }) => Promise<void>; postMessage: ReturnType<typeof vi.fn> };
beforeAll(async () => {
  mocks.model.mockResolvedValue(null);
  worker = { onmessage: async () => {}, postMessage: vi.fn() };
  vi.stubGlobal("self", worker);
  await import("../workers/recognition.worker");
});

/** The rehearsal harness's sequence(): signs separated by rests with the hands out of view. */
function sequence(signs: readonly string[], restMs: number) {
  const frames: VisionFrame[] = [];
  for (const sign of signs) {
    const offset = frames.length ? frames.at(-1)!.timestamp + 50 - 1000 : 0;
    const take = makeSign(sign as Sign).map(frame => ({ ...frame, timestamp: frame.timestamp + offset }));
    frames.push(...take, ...Array.from({ length: Math.round(restMs / 50) }, (_, i) => ({ ...take.at(-1)!, hands: [], timestamp: take.at(-1)!.timestamp + (i + 1) * 50 })));
  }
  return frames;
}
const seeded = (seed: number) => () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };

/** Deliver the script through the frame loop at `interval` ms (± jitter), one frame per tick. */
async function deliver(frames: VisionFrame[], interval: number, jitter = 0, seed = 1) {
  const script = new RehearsalScript();
  script.play(frames);
  const random = seeded(seed);
  worker.postMessage.mockClear();
  await worker.onmessage({ data: { type: "reset" } });
  let now = 10000, delivered = 0;
  while (script.playing) {
    now += interval * (1 + jitter * (2 * random() - 1));
    const frame = script.next(now);
    if (!frame) break;
    delivered++;
    await worker.onmessage({ data: { type: "frame", frame } });
    await Promise.resolve();
  }
  // Rest after the script, as the smoke does before reading the transcript.
  for (let i = 0; i < 10; i++) { now += interval; await worker.onmessage({ data: { type: "frame", frame: { timestamp: now, hands: [], face: [], pose: [] } } }); }
  const messages = worker.postMessage.mock.calls.map(([m]) => m as WorkerMessage);
  const words = messages.filter(m => m.type === "confirmed").map(m => (m as { gloss: string }).gloss);
  // Longest run of consecutive analyses in which the rule reports this word:
  // two-evidence confirmation needs a run of at least two.
  const analyses = messages.filter(m => m.type === "analysis");
  const evidence = (label: string) => analyses.reduce(([best, run], m) => {
    const next = m.candidate === label && m.source === "starter" ? run + 1 : 0;
    return [Math.max(best, next), next];
  }, [0, 0])[0];
  return { words, delivered, fps: +(1000 / interval).toFixed(1),
    evidence: Object.fromEntries(ASL_DEMO_WORDS.map(word => [word, evidence(word)])) };
}

const INTERVALS = [50, 75, 100, 125, 150, 200, 250, 300];
const rapid = sequence(ASL_DEMO_WORDS, 250);

describe("rapid six-word sequence under reduced frame-loop throughput", () => {
  it("keeps the invariant at every rate: only intended words, in order, never a duplicate", async () => {
    for (const interval of INTERVALS) for (const seed of [1, 2, 3]) {
      const { words } = await deliver(rapid, interval, 0.3, seed);
      const positions = words.map(word => ASL_DEMO_WORDS.indexOf(word as typeof ASL_DEMO_WORDS[number]));
      expect(positions.every(position => position >= 0), `${interval} ms: ${words.join(", ")}`).toBe(true);
      expect(positions, `${interval} ms out of order: ${words.join(", ")}`).toEqual([...positions].sort((a, b) => a - b));
      expect(new Set(words).size).toBe(words.length);
    }
  });
  it("confirms all six words at 20 analysed frames per second", async () => {
    for (const seed of [1, 2, 3]) expect((await deliver(rapid, 50, 0.3, seed)).words).toEqual([...ASL_DEMO_WORDS]);
  });
  it("loses a word exactly when no two consecutive analyses saw its completed stroke", async () => {
    // Every frame is answered (no starvation); a word is lost when sampling at
    // the reduced rate catches its completion in at most one analysis before
    // the hand leaves view, so two-evidence confirmation never has two in a row.
    for (const interval of INTERVALS) for (const seed of [1, 2, 3]) {
      const result = await deliver(rapid, interval, 0.3, seed);
      for (const word of ASL_DEMO_WORDS) {
        const lost = !result.words.includes(word);
        expect(lost, `${word} at ${interval} ms (seed ${seed}): longest run ${result.evidence[word]}, ${lost ? "lost" : "confirmed"}`)
          .toBe(result.evidence[word] < 2);
      }
    }
  });
  it.runIf(process.env.RUN_LOW_THROUGHPUT_REPORT === "1")("writes the low-throughput record", async () => {
    const rows: object[] = [];
    for (const rest of [250, 700]) for (const interval of INTERVALS) {
      const runs: Awaited<ReturnType<typeof deliver>>[] = [];
      for (const seed of [1, 2, 3, 4, 5]) runs.push(await deliver(sequence(ASL_DEMO_WORDS, rest), interval, 0.3, seed));
      rows.push({ rest_ms: rest, frame_interval_ms: interval, analysed_fps: +(1000 / interval).toFixed(1),
        confirmed_per_word: Object.fromEntries(ASL_DEMO_WORDS.map(word => [word, runs.filter(run => run.words.includes(word)).length])),
        longest_consecutive_rule_run_median: Object.fromEntries(ASL_DEMO_WORDS.map(word => [word, runs.map(run => run.evidence[word]).sort((a, b) => a - b)[2]])),
        runs: runs.length });
    }
    writeFileSync("docs/refinement/sprint-5/low-throughput.json", JSON.stringify({ schema: 1,
      status: "Synthetic kinematics through the real recognition worker, rules only (model abstains). Not recordings, not accuracy, not a device measurement.",
      method: "tests/asl-low-throughput.test.ts: the rehearsal sequence replayed by RehearsalScript against a frame loop at the given interval with ±30% jitter, 5 seeds",
      rows }, null, 2) + "\n");
  });
});
