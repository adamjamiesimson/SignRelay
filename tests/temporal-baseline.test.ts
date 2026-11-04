// Mechanics of the replacement-recognizer research framework, on synthetic
// kinematic fixtures only. These tests check invariances, segmentation,
// signer-disjoint folds and the metrics arithmetic; they make no accuracy claim.
import { describe, expect, it } from "vitest";
import { CHANNEL_INDEX, extractFeatures, repetitionOf, resample, segmentActive } from "../lib/sign-features";
import { BASELINE_CONFIG, OTHER, dtw, encode, predictBaseline, trainBaseline } from "../lib/temporal-baseline";
import { runExperiment, signerFolds, type Example, type Predictor } from "../lib/temporal-experiment";
import { starterRulesPredictor, temporalBaselinePredictor } from "../lib/temporal-predictors";
import type { VisionFrame } from "../lib/vision-types";
import { makeSign, type Sign } from "./fixtures/asl-motion";
import { NEGATIVE_CONTROLS } from "./fixtures/asl-negative-controls";

const still = (frames: VisionFrame[], ms: number, before: boolean) => {
  const f = before ? frames[0] : frames.at(-1)!;
  return Array.from({ length: Math.round(ms / 40) }, (_, i) => ({ ...structuredClone(f), timestamp: before ? f.timestamp - ms + i * 40 : f.timestamp + (i + 1) * 40 }));
};
const padded = (frames: VisionFrame[]) => [...still(frames, 600, true), ...frames, ...still(frames, 600, false)];
const mean = (rows: number[][], c: number) => rows.reduce((s, r) => s + r[c], 0) / rows.length;

describe("body-relative features", () => {
  it("do not change with the signer's distance from the camera or position in frame", () => {
    const a = extractFeatures(makeSign("PLEASE")).rows, b = extractFeatures(makeSign("PLEASE", { scale: 1.2, shiftY: 0.04 })).rows;
    for (const channel of ["wrist_x", "wrist_y", "d_chest", "ext_index", "aperture"]) expect(mean(b, CHANNEL_INDEX[channel])).toBeCloseTo(mean(a, CHANNEL_INDEX[channel]), 1);
  });
  it("map left-dominant signing onto the right-handed layout (mirror)", () => {
    const right = extractFeatures(makeSign("HELLO", { side: "Right" })), left = extractFeatures(makeSign("HELLO", { side: "Left" }));
    expect(left.mirrored).toBe(true); expect(right.mirrored).toBe(false);
    for (const channel of ["wrist_x", "wrist_y", "tip_x", "ext_middle", "palm_z"]) expect(mean(left.rows, CHANNEL_INDEX[channel])).toBeCloseTo(mean(right.rows, CHANNEL_INDEX[channel]), 2);
  });
  it("separate handshapes and locations the rules confuse: fist vs open hand, chest vs mouth", () => {
    const sorry = extractFeatures(makeSign("SORRY")).rows, please = extractFeatures(makeSign("PLEASE")).rows, thanks = extractFeatures(makeSign("THANK YOU")).rows;
    expect(mean(please, CHANNEL_INDEX.ext_index)).toBeGreaterThan(mean(sorry, CHANNEL_INDEX.ext_index) + 0.2);
    // Location: the chest circle sits lower than THANK YOU's start near the face (wrist height, body-relative).
    expect(mean(please, CHANNEL_INDEX.wrist_y)).toBeGreaterThan(thanks[0][CHANNEL_INDEX.wrist_y] + 0.3);
  });
});

describe("temporal structure", () => {
  it("finds the active span inside still lead-in and ending", () => {
    const frames = padded(makeSign("THANK YOU", { count: 25, duration: 1000 }));
    const seq = extractFeatures(frames), span = segmentActive(seq)!;
    expect(span[0]).toBeGreaterThan(5); expect(span[1]).toBeLessThan(seq.rows.length - 5);
    expect(segmentActive(extractFeatures(still(makeSign("NO"), 2000, true)))).toBeNull();
  });
  it("measures repetition: a circle reverses direction, a single stroke does not", () => {
    const circle = repetitionOf(extractFeatures(makeSign("PLEASE", { count: 33, duration: 1400 })).rows);
    const stroke = repetitionOf(extractFeatures(makeSign("THANK YOU", { count: 33, duration: 1400 })).rows);
    expect(circle.reversals).toBeGreaterThan(stroke.reversals);
  });
  it("resamples to a fixed length and DTW is zero for identical sequences", () => {
    const rows = extractFeatures(makeSign("HELLO")).rows;
    expect(resample(rows, 24)).toHaveLength(24);
    const enc = encode(makeSign("HELLO"));
    expect(enc.ok).toBe(true);
    expect(dtw(enc.rows, enc.rows, 0.2)).toBe(0);
    expect(encode(still(makeSign("NO"), 1500, true))).toMatchObject({ ok: false, reason: "no-motion" });
  });
});

// Synthetic "signers": consistent personal variation (size, position, speed, jitter, hand).
const SIGNERS = [
  { id: "s1", scale: 1, shiftY: 0, duration: 900, jitter: 0, side: "Right" as const },
  { id: "s2", scale: 1.12, shiftY: 0.03, duration: 1100, jitter: 0.002, side: "Right" as const },
  { id: "s3", scale: 0.9, shiftY: -0.02, duration: 750, jitter: 0.003, side: "Left" as const },
  { id: "s4", scale: 1.05, shiftY: 0.01, duration: 1300, jitter: 0.001, side: "Right" as const },
  { id: "s5", scale: 0.95, shiftY: 0.02, duration: 1000, jitter: 0.002, side: "Left" as const },
];
const TARGETS: Sign[] = ["HELLO", "NO", "YES", "PLEASE", "SORRY", "THANK YOU"];
function syntheticExamples(): Example[] {
  const out: Example[] = [];
  for (const s of SIGNERS) {
    for (const gloss of TARGETS) for (const take of [0, 1]) {
      const count = Math.round((s.duration + take * 150) / 45);
      out.push({ id: `${s.id}-${gloss}-${take}`, gloss, kind: "target", signer: s.id, source: "synthetic", exposure: "untouched",
        frames: padded(makeSign(gloss, { scale: s.scale, shiftY: s.shiftY, jitter: s.jitter, side: s.side, duration: s.duration + take * 150, count })) });
    }
    for (const [name, make] of Object.entries(NEGATIVE_CONTROLS)) out.push({ id: `${s.id}-neg-${name}`, gloss: null, kind: "everyday", signer: s.id, source: "synthetic", exposure: "untouched", frames: make() });
  }
  return out;
}

describe("signer-disjoint experiment framework", () => {
  it("uses leave-one-signer-out, or deterministic signer groups, never splitting a signer", () => {
    const examples = syntheticExamples();
    expect(signerFolds(examples)).toEqual([["s1"], ["s2"], ["s3"], ["s4"], ["s5"]]);
    const many = Array.from({ length: 30 }, (_, i) => ({ ...examples[0], id: `x${i}`, signer: `p${i}` }));
    const grouped = signerFolds(many, 4);
    expect(grouped.flat().sort()).toEqual([...new Set(many.map(e => e.signer))].sort());
    expect(signerFolds(many, 4)).toEqual(grouped);
  });
  it("never trains on the test signer, and reports exposed data separately with caveats", () => {
    const seen: string[][] = [];
    const spy: Predictor = { name: "spy", fit: train => seen.push([...new Set(train.map(e => e.signer))]), predict: () => ({ label: null }) };
    const examples = syntheticExamples().map(e => (e.signer === "s1" ? { ...e, exposure: "exposed" as const } : e));
    const report = runExperiment(examples, [spy]);
    expect(seen).toHaveLength(5);
    seen.forEach((train, i) => expect(train).not.toContain(`s${i + 1}`));
    expect(report.dataset.byExposure).toEqual({ exposed: examples.filter(e => e.signer === "s1").length, untouched: examples.filter(e => e.signer !== "s1").length });
    expect(report.predictors.spy.untouchedOnly!.targets.support).toBe(4 * 12);
    const allExposed = runExperiment(examples.map(e => ({ ...e, exposure: "exposed" as const })), [spy]);
    expect(allExposed.caveats.join()).toMatch(/development estimate only/);
    expect(allExposed.predictors.spy.untouchedOnly).toBeNull();
  });
  it("computes per-sign precision/recall, abstention and false accepts on 'other' exactly", () => {
    const ex = (id: string, gloss: string | null, kind: Example["kind"] = gloss ? "target" : "everyday"): Example =>
      ({ id, gloss, kind, signer: id.slice(0, 2), source: "t", exposure: "untouched", frames: [] });
    const examples = [ex("a1", "NO"), ex("a2", "NO"), ex("b1", "YES"), ex("b2", null), ex("c1", null, "confusable")];
    const answers: Record<string, string | null> = { a1: "NO", a2: null, b1: "NO", b2: "NO", c1: null };
    let current = "";
    const fixed: Predictor = { name: "fixed", predict: () => ({ label: answers[current] }) };
    const original = fixed.predict;
    const wrapped: Predictor = { name: "fixed", predict: frames => original(frames) };
    const ordered = examples.map(e => ({ ...e, frames: [{ timestamp: 0, hands: [], face: [], pose: [], id: e.id } as unknown as VisionFrame] }));
    wrapped.predict = frames => { current = (frames[0] as unknown as { id: string }).id; return original(frames); };
    const r = runExperiment(ordered, [wrapped]).predictors.fixed.all;
    expect(r.targets).toMatchObject({ support: 3, correct: 1, wrong: 1, abstained: 1 });
    expect(r.targets.byGloss.NO).toMatchObject({ support: 2, correct: 1, predicted: 3, precision: 1 / 3, recall: 0.5 });
    expect(r.other).toMatchObject({ support: 2, falseAccept: 1, falseAcceptAs: { NO: 1 }, byKind: { everyday: { support: 1, falseAccept: 1 }, confusable: { support: 1, falseAccept: 0 } } });
  });
  it("runs the starter rules and the temporal baseline on the same folds (synthetic sanity check, not evidence)", () => {
    const report = runExperiment(syntheticExamples(), [starterRulesPredictor(), temporalBaselinePredictor()]);
    expect(report.folds).toMatchObject({ count: 5, scheme: "leave-one-signer-out" });
    for (const name of ["starter-rules", "temporal-baseline"]) {
      const r = report.predictors[name].all;
      expect(r.targets.support).toBe(60);
      expect(r.targets.correct + r.targets.wrong + r.targets.abstained).toBe(60);
      expect(r.other.support).toBe(5 * Object.keys(NEGATIVE_CONTROLS).length);
    }
    expect(report.predictors["temporal-baseline"].all.riskCoverage).toHaveLength(4);
    expect(report.predictors["starter-rules"].all.riskCoverage).toBeNull();
    // The baseline must at least learn the synthetic signs from other synthetic signers.
    expect(report.predictors["temporal-baseline"].all.targets.correct).toBeGreaterThan(30);
  });
  it("calibrates rejection on training signers only and abstains on unusable input", () => {
    const train = syntheticExamples().filter(e => e.signer !== "s5").map(e => ({ frames: e.frames, label: e.gloss ?? OTHER, signer: e.signer }));
    const model = trainBaseline(train);
    expect(model.labels).toContain(OTHER);
    expect(Number.isFinite(model.tau)).toBe(true);
    expect(model.rho).toBeGreaterThan(0);
    expect(model.config).toBe(BASELINE_CONFIG);
    expect(predictBaseline(model, still(makeSign("NO"), 1500, true))).toMatchObject({ label: null, reason: "unusable" });
  });
});
