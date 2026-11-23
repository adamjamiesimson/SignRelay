import { readFileSync, writeFileSync } from "node:fs";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { ASL_DEMO_WORDS } from "../lib/capability-status";
import type { VisionFrame, WorkerInput, WorkerMessage } from "../lib/vision-types";
import { makeSign, type Sign } from "./fixtures/asl-motion";

// Temporal segmentation stress on synthetic kinematics through the real worker.
// Invariants hold for every scenario: only intended words, in order, with no
// duplicate inside the cooldown. Recall per scenario is recorded (not required)
// in docs/gitex/sprint-2/temporal-stress.json; regenerate with UPDATE_TEMPORAL=1.
const OUT = "docs/gitex/sprint-2/temporal-stress.json";
const mocks = vi.hoisted(() => ({ model: vi.fn() }));
vi.mock("../lib/asl1000-runtime", () => ({ recognizeAsl1000: mocks.model }));
let worker: { onmessage: (event: { data: WorkerInput }) => Promise<void>; postMessage: ReturnType<typeof vi.fn> };
async function run(frames: VisionFrame[]) {
  worker.postMessage.mockClear();
  await worker.onmessage({ data: { type: "reset" } });
  for (const frame of frames) { await worker.onmessage({ data: { type: "frame", frame } }); await Promise.resolve(); }
  return worker.postMessage.mock.calls.map(([m]) => m as WorkerMessage).filter(m => m.type === "confirmed").map(m => (m as { gloss: string }).gloss);
}
type Rest = "lowered" | "held";
const shift = (frames: VisionFrame[], by: number) => frames.map(frame => ({ ...frame, timestamp: frame.timestamp + by }));
function pause(after: VisionFrame, ms: number, kind: Rest, step = 50) {
  return Array.from({ length: Math.round(ms / step) }, (_, i) => ({ ...structuredClone(after), hands: kind === "lowered" ? [] : structuredClone(after.hands), timestamp: after.timestamp + (i + 1) * step }));
}
function chain(takes: VisionFrame[][], gapMs: number, kind: Rest = "lowered") {
  const frames: VisionFrame[] = [];
  for (const take of takes) {
    const start = frames.length ? frames.at(-1)!.timestamp + 50 - take[0].timestamp : 0;
    const placed = shift(take, start);
    frames.push(...placed, ...pause(placed.at(-1)!, gapMs, kind));
  }
  return frames;
}
const signs = (list: readonly string[], options?: Parameters<typeof makeSign>[1]) => list.map(sign => makeSign(sign as Sign, options));
const seeded = (seed: number) => () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };

type Scenario = { intended: string[]; frames: () => VisionFrame[]; cooldownDuplicatesAllowed?: boolean };
const SCENARIOS: Record<string, Scenario> = {
  ...Object.fromEntries([0, 100, 250, 400, 700, 1500].flatMap(gap => (["lowered", "held"] as const).map(kind => [
    `six words, ${gap} ms pause, hands ${kind}`, { intended: [...ASL_DEMO_WORDS], frames: () => chain(signs(ASL_DEMO_WORDS), gap, kind) }]))),
  ...Object.fromEntries([500, 1500, 3000].map(gap => [`HELLO twice, ${gap} ms apart`, { intended: ["HELLO", "HELLO"], frames: () => chain(signs(["HELLO", "HELLO"]), gap) }])),
  "partial PLEASE (40%), then SORRY": { intended: ["SORRY"], frames: () => chain([makeSign("PLEASE").slice(0, 9), makeSign("SORRY")], 700) },
  "partial THANK YOU (30%), then NO": { intended: ["NO"], frames: () => chain([makeSign("THANK YOU").slice(0, 7), makeSign("NO")], 700) },
  "SORRY interrupted by 400 ms tracking loss, then finished": { intended: ["SORRY"], frames: () => {
    const take = makeSign("SORRY");
    return chain([[...take.slice(0, 10), ...pause(take[9], 400, "lowered"), ...shift(take.slice(10), 400)]], 700);
  } },
  "HELLO then an 8 s still hold": { intended: ["HELLO"], frames: () => chain(signs(["HELLO"]), 8000, "held") },
  "six words with ±30% frame-interval jitter": { intended: [...ASL_DEMO_WORDS], frames: () => {
    const random = seeded(17);
    let t = 1000;
    return chain(signs(ASL_DEMO_WORDS), 700).map((frame, i) => ({ ...frame, timestamp: (t += i ? 45 * (0.7 + 0.6 * random()) : 0) }));
  } },
  // Headless Chromium on a 4-core Xeon tracks at about 4–6 frames/s (?perf);
  // the rehearsal smoke lost PLEASE, SORRY and YES at that rate.
  ...Object.fromEntries([5, 6, 7, 8].map(fps => [`six words at ${fps} fps`, { intended: [...ASL_DEMO_WORDS], frames: () => chain(signs(ASL_DEMO_WORDS, { count: Math.round(fps * 0.9) + 1 }), 700) }])),
  "frame rate drops from 22 to 10 fps mid-sequence": { intended: [...ASL_DEMO_WORDS], frames: () =>
    chain([...signs(ASL_DEMO_WORDS.slice(0, 3)), ...signs(ASL_DEMO_WORDS.slice(3), { count: 10 })], 700) },
  // Outside the input contract: the app forwards at most one frame per 50 ms
  // with strictly increasing performance.now() timestamps. Equal timestamps
  // break tracking continuity, so the worker abstains rather than guessing.
  "contract violation: every frame delivered twice with the same timestamp": { intended: [...ASL_DEMO_WORDS], frames: () => chain(signs(ASL_DEMO_WORDS), 700).flatMap(frame => [frame, structuredClone(frame)]) },
  "clock jumps backwards between words": { intended: [...ASL_DEMO_WORDS], frames: () => {
    const frames = chain(signs(ASL_DEMO_WORDS), 700);
    const jump = frames.findIndex((frame, i) => i > 30 && !frame.hands.length);
    return [...frames.slice(0, jump), ...shift(frames.slice(jump), -5000)];
  } },
  "six words repeated five times": { intended: Array.from({ length: 5 }, () => [...ASL_DEMO_WORDS]).flat(), frames: () => chain(signs(Array.from({ length: 5 }, () => [...ASL_DEMO_WORDS]).flat()), 700) },
};

/** True when `got` is an in-order subsequence of `intended`. */
const subsequence = (got: string[], intended: string[]) => { let i = 0; for (const word of got) { while (i < intended.length && intended[i] !== word) i++; if (i++ >= intended.length) return false; } return true; };
const outcomes: Record<string, { intended: number; confirmed: string[] }> = {};
/** Earliest prefix of each sign's 21-frame take (movement completes at frame 16) that confirms it, and anything else confirmed on the way. */
const earliest: Record<string, { first_confirming_frames: number | null; movement_fraction: number | null; other_words: string[] }> = {};
beforeAll(async () => {
  mocks.model.mockResolvedValue(null);
  worker = { onmessage: async () => {}, postMessage: vi.fn() };
  vi.stubGlobal("self", worker);
  await import("../workers/recognition.worker");
  for (const [name, scenario] of Object.entries(SCENARIOS)) outcomes[name] = { intended: scenario.intended.length, confirmed: await run(scenario.frames()) };
  for (const sign of ASL_DEMO_WORDS) {
    const take = makeSign(sign as Sign);
    earliest[sign] = { first_confirming_frames: null, movement_fraction: null, other_words: [] };
    for (let k = 5; k <= take.length; k++) {
      const words = await run(chain([take.slice(0, k)], 700));
      earliest[sign].other_words.push(...words.filter(word => word !== sign && !earliest[sign].other_words.includes(word)));
      if (words.includes(sign) && earliest[sign].first_confirming_frames === null)
        earliest[sign] = { ...earliest[sign], first_confirming_frames: k, movement_fraction: Math.min(1, Math.round((k - 1) / 20 / 0.75 * 100) / 100) };
    }
  }
}, 120000);

describe("temporal segmentation stress", () => {
  it.each(Object.keys(SCENARIOS))("%s: only intended words, in order", name => {
    const { confirmed } = outcomes[name];
    expect(confirmed.every(word => SCENARIOS[name].intended.includes(word)), confirmed.join(", ")).toBe(true);
    expect(subsequence(confirmed, SCENARIOS[name].intended), confirmed.join(", ")).toBe(true);
  });
  it("a repeated word inside the 2.6 s cooldown is confirmed once, and twice after it", () => {
    expect(outcomes["HELLO twice, 500 ms apart"].confirmed).toEqual(["HELLO"]);
    expect(outcomes["HELLO twice, 3000 ms apart"].confirmed).toEqual(["HELLO", "HELLO"]);
  });
  it("established demo conditions keep every word (lowered hands, ≥400 ms rests; long sessions)", () => {
    for (const name of ["six words, 400 ms pause, hands lowered", "six words, 700 ms pause, hands lowered", "six words, 1500 ms pause, hands lowered", "six words repeated five times"])
      expect(outcomes[name].confirmed, name).toEqual(SCENARIOS[name].intended);
  });
  it("a truncated sign never confirms as a different word", () => {
    for (const sign of ASL_DEMO_WORDS) expect(earliest[sign].other_words, sign).toEqual([]);
  });
  it("recall per scenario matches the committed record (regenerate with UPDATE_TEMPORAL=1)", () => {
    const json = { schema: 1, status: "Synthetic kinematics through the real worker; not recordings or accuracy.", generated_by: "UPDATE_TEMPORAL=1 npx vitest run tests/asl-temporal-stress.test.ts",
      earliest_confirmation: earliest,
      scenarios: Object.fromEntries(Object.entries(outcomes).map(([name, o]) => [name, { intended: o.intended, confirmed: o.confirmed.length, words: o.confirmed.join(" ") }])) };
    if (process.env.UPDATE_TEMPORAL === "1") writeFileSync(OUT, JSON.stringify(json, null, 2) + "\n");
    expect(json).toEqual(JSON.parse(readFileSync(OUT, "utf8")));
  });
});
