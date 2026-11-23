import { beforeEach, describe, expect, it, vi } from "vitest";
import { analyzeAslStarter } from "../lib/asl-starter-recognition";
import type { VisionFrame, WorkerAnalysis, WorkerInput, WorkerMessage } from "../lib/vision-types";
import { handshape, makeSign } from "./fixtures/asl-motion";
import { trajectory } from "./fixtures/asl-negative-controls";

// HELLO, THANK YOU/PLEASE and YES failure-pattern probes on synthetic kinematics.
// They pin down designed abstentions and negative controls; they do not
// reproduce the real development clips, whose traces are not available here.
const mocks = vi.hoisted(() => ({ model: vi.fn() }));
vi.mock("../lib/asl1000-runtime", () => ({ recognizeAsl1000: mocks.model }));
let worker: { onmessage: (event: { data: WorkerInput }) => Promise<void>; postMessage: ReturnType<typeof vi.fn> };
const sent = () => worker.postMessage.mock.calls.map(([m]) => m as WorkerMessage);
const words = () => sent().filter(m => m.type === "confirmed").map(m => (m as { gloss: string }).gloss);
const candidates = () => sent().filter((m): m is WorkerAnalysis => m.type === "analysis").map(m => m.candidate);
async function feed(frames: VisionFrame[]) {
  for (const frame of frames) { await worker.onmessage({ data: { type: "frame", frame } }); await Promise.resolve(); }
}
const later = (frames: VisionFrame[], by: number) => frames.map(frame => ({ ...structuredClone(frame), timestamp: frame.timestamp + by }));
const hold = (frames: VisionFrame[], ms = 400) => {
  const last = frames.at(-1)!;
  return [...frames, ...Array.from({ length: Math.round(ms / 50) }, (_, i) => ({ ...structuredClone(last), timestamp: last.timestamp + (i + 1) * 50 }))];
};
/** The makeSign YES wrist nod with a chosen handshape. */
function nod(shape: "fist" | "open", phases = 1) {
  return makeSign("YES", { count: 21 * phases, duration: 900 * phases }).map((frame, index) => {
    const phase = Math.min(1, ((index % 21) / 20) / 0.75);
    const pitch = 0.15 + 0.8 * Math.sin(Math.PI * phase) ** 2;
    const wrist = frame.hands[0].landmarks[0];
    return { ...frame, hands: [{ ...frame.hands[0], landmarks: handshape(shape).map(point => ({
      x: wrist.x + point.x, y: wrist.y + point.y * Math.cos(pitch), z: point.y * Math.sin(pitch) })) }] };
  });
}
beforeEach(async () => {
  vi.resetModules();
  mocks.model.mockReset().mockResolvedValue(null);
  worker = { onmessage: async () => {}, postMessage: vi.fn() };
  vi.stubGlobal("self", worker);
  await import("../workers/recognition.worker");
});

describe("HELLO", () => {
  it("keeps two-evidence confirmation: one HELLO proposal followed by a lost hand abstains", async () => {
    const frames = makeSign("HELLO");
    const first = frames.findIndex((_, n) => analyzeAslStarter(frames.slice(0, n + 1)).prediction?.label === "HELLO");
    expect(first).toBeGreaterThan(0);
    await feed([...frames.slice(0, first + 1), ...later(frames.slice(first + 1), 0).map(frame => ({ ...frame, hands: [] }))]);
    expect(candidates().filter(label => label === "HELLO")).toHaveLength(1);
    expect(words()).toEqual([]);
  });
  it("abstains when the same sideways sweep is performed at chest height", async () => {
    await feed(hold(trajectory([{ t: 0, x: 0.52, y: 0.8 }, { t: 0.5, x: 0.7, y: 0.8 }, { t: 1, x: 0.55, y: 0.8 }], { duration: 900 })));
    expect(words()).toEqual([]);
  });
  it("abstains for a small sideways movement at the forehead", async () => {
    await feed(trajectory([{ t: 0, x: 0.58, y: 0.4 }, { t: 1, x: 0.63, y: 0.4 }], { duration: 700 }));
    expect(words()).toEqual([]);
  });
});

describe("THANK YOU versus PLEASE", () => {
  it("separates a THANK YOU stroke followed by a PLEASE circle into two words in order", async () => {
    await feed(makeSign("THANK YOU"));
    await feed(hold(later(makeSign("PLEASE"), 1100)));
    expect(words()).toEqual(["THANK YOU", "PLEASE"]);
  });
  it("does not call a fist leaving the mouth THANK YOU", async () => {
    await feed(hold(trajectory([{ t: 0, x: 0.53, y: 0.5, shape: "fist" }, { t: 1, x: 0.7, y: 0.66, shape: "fist" }], { duration: 800 })));
    expect(words()).not.toContain("THANK YOU");
  });
  it("does not call an open hand rising from the chin to the forehead THANK YOU", async () => {
    // HELLO is a recorded synthetic risk for this movement; see known-false-accept-risks.json.
    await feed(hold(trajectory([{ t: 0, x: 0.53, y: 0.5 }, { t: 1, x: 0.68, y: 0.36 }], { duration: 800 })));
    expect(words()).not.toContain("THANK YOU");
  });
  it("reports both competing labels for a mouth stroke that loops back over the chest", () => {
    const frames = [...makeSign("THANK YOU", { count: 14, duration: 600 }), ...later(makeSign("PLEASE", { count: 14, duration: 600 }), 620)];
    const competing = new Set<string>();
    for (let n = 6; n <= frames.length; n++) {
      const result = analyzeAslStarter(frames.slice(0, n));
      [...result.labels, ...result.incompleteLabels].forEach(label => competing.add(label));
    }
    expect([...competing]).toEqual(expect.arrayContaining(["THANK YOU"]));
  });
});

describe("YES", () => {
  it("confirms one YES for a repeated double nod", async () => {
    await feed(hold(nod("fist", 2)));
    expect(words()).toEqual(["YES"]);
  });
  it("abstains for only the downward half of a nod", async () => {
    await feed(hold(nod("fist").slice(0, 8)));
    expect(words()).toEqual([]);
  });
  it("does not call an open hand nodding YES", async () => {
    await feed(hold(nod("open")));
    expect(words()).not.toContain("YES");
  });
  it("abstains when only four hand frames are observed, like the sparse development take", async () => {
    await feed(hold(nod("fist").map((frame, i) => [4, 8, 12, 16].includes(i) ? frame : { ...frame, hands: [] })));
    expect(words()).toEqual([]);
  });
  it("lets a confident model YES through only with a completed wrist nod", async () => {
    mocks.model.mockResolvedValue({ label: "YES", text: "Yes", confidence: 0.99, margin: 0.9 });
    await feed(hold(trajectory([{ t: 0, x: 0.6, y: 0.75, shape: "fist" }, { t: 1, x: 0.75, y: 0.6, shape: "fist" }], { duration: 900 })));
    expect(words()).toEqual([]);
  });
});
