import { beforeEach, describe, expect, it, vi } from "vitest";
import { circularMotion } from "../lib/asl-starter-recognition";
import type { WorkerInput, WorkerMessage } from "../lib/vision-types";
import { trajectory } from "./fixtures/asl-negative-controls";

// SORRY / PLEASE loop geometry under adversarial shapes. The enclosed-area
// requirement (Sprint 1 fix) must keep straight strokes and zigzags from
// counting as a loop, and closure must keep partial arcs from emitting, while
// real circles and ellipses still do. Paths are in shoulder-width units and go
// through the same absolute-span gate as completedPalmCircle, because
// circularMotion normalizes each axis and is scale-free on its own.
type Path = { xs: number[]; ys: number[] };
const seeded = (seed: number) => () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 - 0.5; };
const sample = (n: number, f: (t: number) => [number, number]): Path => {
  const points = Array.from({ length: n }, (_, i) => f(i / (n - 1)));
  return { xs: points.map(p => p[0]), ys: points.map(p => p[1]) };
};
const span = (values: number[]) => Math.max(...values) - Math.min(...values);
const loop = ({ xs, ys }: Path, closure: boolean) => span(xs) > 0.1 && span(ys) > 0.1 && circularMotion(xs, ys, closure);
const ellipse = (sweep: number, rx = 0.2, ry = 0.2, rotate = 0, n = 24) => sample(n, t => {
  const a = t * sweep, x = rx * Math.cos(a), y = ry * Math.sin(a);
  return [x * Math.cos(rotate) - y * Math.sin(rotate), x * Math.sin(rotate) + y * Math.cos(rotate)];
});
const noisy = (path: Path, amount: number, seed: number) => {
  const random = seeded(seed);
  const scale = Math.max(Math.max(...path.xs) - Math.min(...path.xs), Math.max(...path.ys) - Math.min(...path.ys));
  return { xs: path.xs.map(x => x + random() * amount * scale), ys: path.ys.map(y => y + random() * amount * scale) };
};
const zigzag = (segments: number, n = 25) => sample(n, t => {
  const phase = t * segments, leg = Math.floor(phase), f = phase - leg;
  return [0.5 * t, 0.2 * (leg % 2 ? 1 - f : f)];
});

/** Never a loop, not even as competing evidence. */
const STROKES: Record<string, Path> = {
  "horizontal line": sample(20, t => [0.5 * t, 0]),
  "vertical line": sample(20, t => [0, 0.5 * t]),
  "diagonal line": sample(20, t => [0.4 * t, 0.4 * t]),
  "up-and-down stroke (the fixed SORRY bug)": sample(25, t => [0.02 * Math.sin(t * 9), 0.4 * Math.abs(Math.sin(t * Math.PI))]),
  "two up-and-down strokes": sample(30, t => [0.02 * Math.sin(t * 11), 0.4 * Math.abs(Math.sin(t * 2 * Math.PI))]),
  "side-to-side shake": sample(30, t => [0.3 * Math.sin(t * 6 * Math.PI), 0.01 * Math.cos(t * 5)]),
  ...Object.fromEntries([3, 4, 6].map(segments => [`zigzag with ${segments} segments`, zigzag(segments)])),
};
/** Partial arcs may compete as evidence (closure off) but must never emit (closure on). */
const PARTIAL_ARCS: Record<string, Path> = {
  "quarter arc": ellipse(Math.PI / 2),
  "half arc": ellipse(Math.PI),
  "two-thirds arc": ellipse(4 * Math.PI / 3),
  "three-quarter arc": ellipse(1.5 * Math.PI),
  "arch (zigzag with 2 segments)": zigzag(2),
};
const LOOPS: Record<string, Path> = {
  circle: ellipse(2 * Math.PI),
  "circle, 10 samples": ellipse(2 * Math.PI, 0.2, 0.2, 0, 10),
  "wide ellipse 3:1": ellipse(2 * Math.PI, 0.3, 0.1),
  "tall ellipse 1:3": ellipse(2 * Math.PI, 0.1, 0.3),
  "rotated ellipse 2.5:1 at 45°": ellipse(2 * Math.PI, 0.25, 0.1, Math.PI / 4),
  "clockwise circle": ellipse(-2 * Math.PI),
  ...Object.fromEntries([1, 2, 3].map(seed => [`circle with 5% noise (seed ${seed})`, noisy(ellipse(2 * Math.PI), 0.05, seed)])),
  ...Object.fromEntries([1, 2, 3].map(seed => [`circle with 10% noise (seed ${seed})`, noisy(ellipse(2 * Math.PI), 0.1, seed)])),
};
const figureEight = sample(32, t => [0.2 * Math.sin(2 * Math.PI * t), 0.1 * Math.sin(4 * Math.PI * t)]);

describe("circular-motion geometry", () => {
  it.each(Object.entries(STROKES))("%s is not a loop, with or without closure", (_, path) => {
    expect(loop(path, false)).toBe(false);
    expect(loop(path, true)).toBe(false);
  });
  it.each(Object.entries(PARTIAL_ARCS))("%s never counts as a completed loop", (_, path) => {
    expect(loop(path, true)).toBe(false);
  });
  it.each(Object.entries(LOOPS))("%s is a closed loop", (_, path) => {
    expect(loop(path, true)).toBe(true);
  });
  it("a whole figure eight has no net area, so the full path is not one loop", () => {
    expect(circularMotion(figureEight.xs, figureEight.ys, true)).toBe(false);
  });
  it("noise cannot turn straight strokes or zigzags into loops (36 seeded trials)", () => {
    const strokes = [STROKES["up-and-down stroke (the fixed SORRY bug)"], STROKES["side-to-side shake"], STROKES["zigzag with 3 segments"]];
    const accepted = strokes.flatMap(path => [0.05, 0.1, 0.15].flatMap(amount => [1, 2, 3, 4].map(seed => noisy(path, amount, seed))))
      .filter(path => loop(path, false));
    expect(accepted).toHaveLength(0);
  });
  it("degenerate input is rejected", () => {
    expect(circularMotion([0, 0, 0, 0, 0], [0, 0, 0, 0, 0], false)).toBe(false);
    expect(circularMotion([0, 1, 0, 1], [0, 1, 1, 0], false)).toBe(false);
  });
});

// The same shapes as fist and open-hand chest movements through the real worker.
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
// Shoulder width is 0.3 of the frame in the fixture body, so shoulder-width
// units map to the frame by 0.3, centred on the chest.
async function confirmedFor(path: Path, shape: "fist" | "open") {
  const cx = (Math.max(...path.xs) + Math.min(...path.xs)) / 2, cy = (Math.max(...path.ys) + Math.min(...path.ys)) / 2;
  const keys = path.xs.map((x, i) => ({ t: i / (path.xs.length - 1), x: 0.5 + (x - cx) * 0.3, y: 0.65 + (path.ys[i] - cy) * 0.3, shape }));
  for (const frame of trajectory(keys, { duration: 1100 })) { await worker.onmessage({ data: { type: "frame", frame } }); await Promise.resolve(); }
  return worker.postMessage.mock.calls.map(([m]) => m as WorkerMessage).filter(m => m.type === "confirmed").map(m => (m as { gloss: string }).gloss);
}
describe("chest loops through the worker", () => {
  it.each([...Object.keys(STROKES), ...Object.keys(PARTIAL_ARCS)])("a fist %s never produces SORRY or PLEASE", async name => {
    const path = STROKES[name] ?? PARTIAL_ARCS[name];
    expect((await confirmedFor(path, "fist")).filter(word => word === "SORRY" || word === "PLEASE")).toEqual([]);
  });
  it.each(["circle", "wide ellipse 3:1", "tall ellipse 1:3", "rotated ellipse 2.5:1 at 45°", "circle with 5% noise (seed 1)"])("a fist %s produces SORRY", async name => {
    expect(await confirmedFor(LOOPS[name], "fist")).toEqual(["SORRY"]);
  });
  it.each(["circle", "wide ellipse 3:1", "circle with 5% noise (seed 2)"])("an open-hand %s produces PLEASE", async name => {
    expect(await confirmedFor(LOOPS[name], "open")).toEqual(["PLEASE"]);
  });
  // Recorded behaviour: the loop search looks for a completed loop ending now,
  // and each lobe of a figure eight is one. It is not an everyday movement.
  it("a fist figure eight is accepted as SORRY because each lobe is a closed loop", async () => {
    expect(await confirmedFor(figureEight, "fist")).toEqual(["SORRY"]);
  });
});
