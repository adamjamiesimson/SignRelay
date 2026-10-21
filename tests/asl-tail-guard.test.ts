import { readFileSync, writeFileSync } from "node:fs";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { VisionFrame, WorkerInput, WorkerMessage } from "../lib/vision-types";
import { ASL_DEMO_WORDS } from "../lib/capability-status";
import { ADVERSARIAL_PATTERNS, VARIATIONS, vary } from "./fixtures/asl-adversarial";
import { CONDITIONS, SIGNS, settle } from "./fixtures/asl-conditions";
import { makeSign } from "./fixtures/asl-motion";
import { NEGATIVE_CONTROLS } from "./fixtures/asl-negative-controls";

// Objective 10 (21 Oct): the `mask-confirmed-sign-tail` experiment through the
// real recognition worker. The harness puts the filter where the app posts
// camera frames and tells it about every confirmation; production imports
// neither. Synthetic kinematics only: not recordings, not accuracy.
// RUN_TAIL_GUARD=1 rewrites docs/gitex/sprint-3/tail-guard.json.
const OUT = "docs/gitex/sprint-3/tail-guard.json";
const mocks = vi.hoisted(() => ({ model: vi.fn() }));
vi.mock("../lib/asl1000-runtime", () => ({ recognizeAsl1000: mocks.model }));
const { EXPERIMENTS, ConfirmedSignTailGuard } = await import("../lib/asl-starter-experiments");

type Word = { gloss: string; source?: string };
type Prediction = { label: string; text: string; confidence: number; margin: number };
type Model = (sequence: VisionFrame[]) => Prediction | null;
let worker: { onmessage: (event: { data: WorkerInput }) => Promise<void>; postMessage: ReturnType<typeof vi.fn> };
beforeAll(async () => {
  worker = { onmessage: async () => {}, postMessage: vi.fn() };
  vi.stubGlobal("self", worker);
  await import("../workers/recognition.worker");
});

async function run(frames: VisionFrame[], model: Model, guarded: boolean): Promise<Word[]> {
  const guard = guarded ? new ConfirmedSignTailGuard() : null;
  mocks.model.mockImplementation(async (sequence: VisionFrame[]) => model(sequence));
  worker.postMessage.mockClear();
  await worker.onmessage({ data: { type: "reset" } });
  const words: Word[] = [];
  for (const frame of frames) {
    const before = worker.postMessage.mock.calls.length;
    await worker.onmessage({ data: { type: "frame", frame: guard ? guard.filter(frame) : frame } });
    await Promise.resolve();
    for (const [message] of worker.postMessage.mock.calls.slice(before) as [WorkerMessage][]) {
      if (message.type !== "confirmed") continue;
      words.push({ gloss: message.gloss, source: message.source });
      guard?.noteConfirmation();
    }
  }
  return words;
}

const word = (label: string): Prediction => ({ label, text: label, confidence: 0.95, margin: 0.8 });
const none: Model = () => null;
const words = (list: Word[]) => list.map(item => item.gloss);
const distractor = (sign: string) => SIGNS[(SIGNS.indexOf(sign as typeof SIGNS[number]) + 1) % SIGNS.length];
const shift = (frames: VisionFrame[], by: number) => frames.map(frame => ({ ...structuredClone(frame), timestamp: frame.timestamp + by }));
const repeatLast = (after: VisionFrame, ms: number, hands: boolean) => Array.from({ length: Math.round(ms / 50) },
  (_, i) => ({ ...structuredClone(after), ...(hands ? {} : { hands: [] }), timestamp: after.timestamp + (i + 1) * 50 }));
/** Hands lowered out of view, as the demo script asks. */
const away = (after: VisionFrame, ms: number) => repeatLast(after, ms, false);
/** Hand held still in view. */
const hold = (after: VisionFrame, ms: number) => repeatLast(after, ms, true);
/** The hand glides from one pose to the next in `ms`, instead of jumping. */
function glide(from: VisionFrame, to: VisionFrame, ms: number): VisionFrame[] {
  const steps = Math.max(1, Math.round(ms / 50));
  return Array.from({ length: steps }, (_, i) => {
    const f = (i + 1) / (steps + 1);
    return { ...structuredClone(from), timestamp: from.timestamp + (i + 1) * 50, hands: from.hands.map((hand, h) => ({ ...hand,
      landmarks: hand.landmarks.map((p, n) => { const q = to.hands[h]?.landmarks[n] ?? p; return { x: p.x + (q.x - p.x) * f, y: p.y + (q.y - p.y) * f, z: p.z + (q.z - p.z) * f }; }) })) };
  });
}
/** Concatenate takes; `between(lastFrame, nextFirstFrame)` supplies the frames between them. */
function chain(parts: VisionFrame[][], between: (last: VisionFrame, next: VisionFrame) => VisionFrame[]) {
  const frames: VisionFrame[] = [];
  for (const [index, part] of parts.entries()) {
    if (index) frames.push(...between(frames.at(-1)!, part[0]));
    const start = frames.length ? frames.at(-1)!.timestamp + 50 - part[0].timestamp : 0;
    frames.push(...shift(part, start));
  }
  return frames;
}
/** A movement no starter rule matches; the stub model calls it GOOD once a segment contains most of it. */
const reach = () => NEGATIVE_CONTROLS["reaching across the chest"]();
function modelSees(frames: VisionFrame[], label = "GOOD"): Model {
  const part = frames.slice(-reach().length - 8, -8);
  const midpoint = part[Math.floor(part.length / 2)].timestamp;
  return sequence => sequence.at(-1)!.timestamp >= midpoint && sequence[0].timestamp <= midpoint ? word(label) : null;
}
const compare = async (frames: VisionFrame[], model: Model) => ({ production: words(await run(frames, model, false)), guarded: words(await run(frames, model, true)) });

describe("mask-confirmed-sign-tail filter", () => {
  const base = makeSign("NO")[0];
  const at = (timestamp: number, dx: number | null): VisionFrame => ({ ...structuredClone(base), timestamp,
    hands: dx === null ? [] : base.hands.map(hand => ({ ...hand, landmarks: hand.landmarks.map(p => ({ ...p, x: p.x + dx })) })) });
  it("is registered and passes frames through untouched until a word is confirmed", () => {
    expect(EXPERIMENTS["mask-confirmed-sign-tail"].objective).toBe(10);
    const guard = new ConfirmedSignTailGuard();
    const frame = at(0, 0);
    expect(guard.filter(frame)).toBe(frame);
    expect(guard.active).toBe(false);
  });
  it("hides the moving hand after a confirmation and releases it once the hand has been still for 300 ms", () => {
    const guard = new ConfirmedSignTailGuard();
    guard.noteConfirmation();
    for (let t = 0; t < 300; t += 50) expect(guard.filter(at(t, t / 1000)).hands).toEqual([]);
    for (let t = 300; t < 600; t += 50) expect(guard.filter(at(t, 0.3)).hands).toEqual([]);
    expect(guard.filter(at(600, 0.3)).hands).toHaveLength(1);
    expect(guard.active).toBe(false);
  });
  it("treats a brief tracker dropout as the same movement and 250 ms out of view as a rest", () => {
    const guard = new ConfirmedSignTailGuard();
    guard.noteConfirmation();
    guard.filter(at(0, 0)); guard.filter(at(50, null)); guard.filter(at(100, null));
    expect(guard.filter(at(150, 0.02)).hands).toEqual([]);
    for (let t = 200; t <= 450; t += 50) guard.filter(at(t, null));
    expect(guard.active).toBe(false);
    expect(guard.filter(at(500, 0)).hands).toHaveLength(1);
    // The released hand is not re-hidden by later frames.
    guard.noteConfirmation(); guard.reset();
    expect(guard.active).toBe(false);
  });
});

const report: Record<string, unknown> = {};
describe("through the real recognition worker", () => {
  it("removes the THANK YOU tail word under every confusion-matrix condition without losing any sign", async () => {
    const rows: Record<string, Record<string, { correct: number; extra_words: number; wrong_or_missing: number }>> = {};
    const extras: string[] = [];
    for (const guarded of [false, true]) {
      const key = guarded ? "guarded" : "production";
      rows[key] = {};
      for (const sign of SIGNS) {
        const takes = [...Object.entries(CONDITIONS).map(([name, make]) => [name, settle(make(sign))] as const),
          ...VARIATIONS.map(v => [`${v.side}/x${v.speed}/d${v.distance}/${v.degradation}`, settle(vary(CONDITIONS["15 fps"](sign), v))] as const)];
        const row = rows[key][sign] = { correct: 0, extra_words: 0, wrong_or_missing: 0 };
        for (const [name, frames] of takes) {
          const out = words(await run(frames, () => word(distractor(sign)), guarded));
          if (out.length === 1 && out[0] === sign) row.correct++;
          else if (out[0] === sign) { row.extra_words++; if (!guarded) extras.push(`${sign} ${name}: ${out.join(" + ")}`); }
          else row.wrong_or_missing++;
        }
      }
    }
    report.confusion_with_confidently_wrong_model = rows;
    report.production_extra_words = extras;
    // Reproduces the Sprint 2 finding (9/51), then removes it with no sign lost.
    expect(rows.production["THANK YOU"].extra_words).toBe(9);
    for (const sign of SIGNS) expect(rows.guarded[sign]).toEqual({ correct: 51, extra_words: 0, wrong_or_missing: 0 });
  }, 300000);

  it("never adds a word on everyday movements", async () => {
    const counts: Record<string, Record<string, number>> = {};
    for (const [target, model] of [["rules", none], ["confidently_wrong_model", () => word("PLEASE")]] as const) {
      for (const guarded of [false, true]) {
        const tally: Record<string, number> = {};
        for (const patterns of Object.values(ADVERSARIAL_PATTERNS)) for (const make of Object.values(patterns)) for (const v of VARIATIONS) {
          const out = await run(vary(make(), v), model, guarded);
          const key = out.length ? out.map(item => `${item.gloss}/${item.source}`).join(" + ") : "abstain";
          tally[key] = (tally[key] ?? 0) + 1;
        }
        counts[`${target}, ${guarded ? "guarded" : "production"}`] = Object.fromEntries(Object.entries(tally).sort());
      }
    }
    report.everyday_movements = counts;
    const worded = (tally: Record<string, number>) => Object.entries(tally).filter(([k]) => k !== "abstain").reduce((n, [, v]) => n + v, 0);
    expect(worded(counts["rules, guarded"])).toBeLessThanOrEqual(worded(counts["rules, production"]));
    expect(worded(counts["confidently_wrong_model, guarded"])).toBeLessThanOrEqual(worded(counts["confidently_wrong_model, production"]));
  }, 300000);

  it("stops a rule word repeating from its own tail after a pause in view", async () => {
    const outcomes: Record<string, { production: string[]; guarded: string[] }> = {};
    for (const sign of SIGNS) for (const pause of [400, 1500, 2500]) for (const [move, between] of [
      ["jump", (last: VisionFrame) => hold(last, pause)],
      ["glide 300 ms", (last: VisionFrame, next: VisionFrame) => { const held = hold(last, pause); return [...held, ...glide(held.at(-1)!, next, 300)]; }],
    ] as const) {
      const frames = settle(chain([makeSign(sign), reach()], between));
      const outcome = await compare(frames, none);
      outcomes[`${sign}, still in view ${pause} ms, ${move} into an unrelated movement`] = outcome;
      // The confirmed sign is never repeated from its own tail, and the filter never adds a word.
      expect(outcome.guarded.filter(gloss => gloss === sign), `${sign} ${pause} ${move}`).toEqual([sign]);
      expect(outcome.guarded.length, `${sign} ${pause} ${move}`).toBeLessThanOrEqual(outcome.production.length);
    }
    report.rule_word_then_unrelated_movement = outcomes;
    report.production_repeated_from_tail = Object.entries(outcomes).filter(([, o]) => o.production.length > 1).map(([name, o]) => `${name}: ${o.production.join(" + ")}`);
  }, 300000);

  it("keeps a model word that follows a rule word after the hands rest", async () => {
    const outcomes: Record<string, { production: string[]; guarded: string[] }> = {};
    for (const sign of SIGNS) for (const [restName, rest] of [["out of view", away], ["held still", hold]] as const) for (const gap of [400, 700, 1500]) {
      const frames = settle(chain([makeSign(sign), reach()], last => rest(last, gap)));
      const outcome = await compare(frames, modelSees(frames));
      outcomes[`${sign} then GOOD, ${restName} ${gap} ms`] = outcome;
      expect(outcome.guarded, `${sign} ${restName} ${gap}`).toEqual([sign, "GOOD"]);
    }
    report.rule_word_then_model_word = outcomes;
  }, 300000);

  it("keeps the scripted demo, alternating words and repeats beyond the same-word cooldown", async () => {
    const outcomes: Record<string, { production: string[]; guarded: string[] }> = {};
    const check = async (name: string, frames: VisionFrame[], expected: string[]) => {
      const outcome = await compare(frames, none);
      outcomes[name] = outcome;
      expect(outcome.guarded, name).toEqual(expected);
      expect(outcome.production, name).toEqual(expected);
    };
    for (const gap of [400, 700, 1500]) {
      await check(`six-word demo, ${gap} ms out of view`, settle(chain(ASL_DEMO_WORDS.map(s => makeSign(s as typeof SIGNS[number])), last => away(last, gap))), [...ASL_DEMO_WORDS]);
      await check(`THANK YOU, HELLO, THANK YOU, ${gap} ms out of view`, settle(chain([makeSign("THANK YOU"), makeSign("HELLO"), makeSign("THANK YOU")], last => away(last, gap))), ["THANK YOU", "HELLO", "THANK YOU"]);
    }
    // The 2.6 s same-word cooldown deliberately merges closer repeats in production.
    for (const sign of SIGNS) await check(`${sign} twice, 2000 ms out of view`, settle(chain([makeSign(sign), makeSign(sign)], last => away(last, 2000))), [sign, sign]);
    report.demo_and_repeats = outcomes;
  }, 300000);

  it("documents its cost: a next movement started with no rest is hidden", async () => {
    const frames = settle(chain([makeSign("THANK YOU"), reach()], () => []));
    const outcome = await compare(frames, modelSees(frames));
    report.no_rest_cost = outcome;
    expect(outcome.guarded).toEqual(["THANK YOU"]);
  }, 60000);

  it("matches the committed report (regenerate with RUN_TAIL_GUARD=1 and explain any change)", () => {
    const json = { schema: 1, experiment: "mask-confirmed-sign-tail",
      status: "OFF in production: no app or worker code imports it. Synthetic kinematic fixtures through the real worker; not recordings, not accuracy, not evidence that it helps real signers.",
      generated_by: "RUN_TAIL_GUARD=1 npx vitest run tests/asl-tail-guard.test.ts",
      parameters: { absent_ms: ConfirmedSignTailGuard.ABSENT_MS, still_ms: ConfirmedSignTailGuard.STILL_MS, still_radius: ConfirmedSignTailGuard.STILL_RADIUS }, ...report };
    if (process.env.RUN_TAIL_GUARD === "1") writeFileSync(OUT, JSON.stringify(json, null, 2) + "\n");
    expect(json).toEqual(JSON.parse(readFileSync(OUT, "utf8")));
  });
});
