import { describe, expect, it } from "vitest";
import { prepareCalibrationSequence, recognizePersonalTemplate, recognizePersonalTemplateAsync,
  sequenceDistance } from "../lib/personalized-recognition";
import { recentContinuousFrames } from "../lib/frame-timing";
import { validHand } from "../lib/asl-starter-recognition";
import type { CalibrationTemplate, VisionFrame } from "../lib/vision-types";
import { makeSign, type Sign } from "./fixtures/asl-motion";

// Unpruned oracle: exact DTW (no cutoff) for every template in every window,
// then the documented decision rule. tests/dtw-bounded.test.ts ties the
// unbounded sequenceDistance to an independent full-matrix implementation.
function oracle(frames: VisionFrame[], templates: CalibrationTemplate[]) {
  if (!templates.length || frames.length < 8 || !frames.at(-1)?.hands.some(validHand)) return null;
  const matches = new Map<string, { template: CalibrationTemplate; distance: number }>();
  let previousLength = 0;
  for (const duration of [650, 1200, 2000, 3000, 4200]) {
    const recent = recentContinuousFrames(frames, duration, frame => frame.hands.some(validHand));
    if (recent.length === previousLength) continue;
    previousLength = recent.length;
    if (recent.length < 8 || recent.filter(frame => frame.hands.some(validHand)).length / recent.length < 0.7) continue;
    for (const template of templates) {
      if (template.frames.length !== 24) continue;
      const distance = sequenceDistance(prepareCalibrationSequence(recent, template.normalization), template.frames);
      if (Number.isFinite(distance) && distance < (matches.get(template.gloss)?.distance ?? Infinity)) {
        matches.set(template.gloss, { template, distance });
      }
    }
  }
  const [best, rival] = [...matches.values()].sort((a, b) => a.distance - b.distance);
  if (!best || best.distance > 0.5 || (rival && rival.distance - best.distance < 0.06)) return null;
  return { label: best.template.gloss, text: best.template.text,
    confidence: Math.min(0.96, Math.max(0, 0.965 - best.distance * 0.24)) };
}

function random(seed: number) {
  return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
}

const SIGNS: Sign[] = ["HELLO", "THANK YOU", "PLEASE", "YES", "NO", "SORRY"];

function vocabulary(seed: number) {
  const next = random(seed);
  const words = 2 + Math.floor(next() * 7);
  const templates: CalibrationTemplate[] = [];
  for (let word = 0; word < words; word++) {
    const sign = SIGNS[Math.floor(next() * SIGNS.length)];
    const base = prepareCalibrationSequence(makeSign(sign, { duration: 1200 + next() * 900, count: 25 + Math.floor(next() * 16) }),
      next() < 0.5 ? "trajectory-v3" : undefined);
    for (let example = 0, examples = 1 + Math.floor(next() * 3); example < examples; example++) {
      // Offsets cluster where pruning decisions are made: near the 0.5
      // acceptance limit and within/just outside the 0.06 rival margin.
      const offset = next() < 0.3 ? 0 : next() * 0.12;
      templates.push({ id: `${seed}-${word}-${example}`, gloss: `WORD${word}`, text: `Word ${word}`,
        createdAt: templates.length + 1, language: "asl", normalization: base.length && next() < 0.5 ? "trajectory-v3" : undefined,
        frames: base.map(row => row.map((value, k) => [0, 66, 132, 173].includes(k) ? value : value + offset)) });
    }
  }
  // Store order must not matter: shuffle.
  for (let i = templates.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1)); [templates[i], templates[j]] = [templates[j], templates[i]];
  }
  return templates;
}

describe("personal matching with a tightening cutoff (synthetic landmarks, not accuracy)", () => {
  it("reaches exactly the unpruned decision, including confidence, across varied vocabularies", async () => {
    const outcomes = { accepted: 0, rejected: 0 };
    for (let seed = 1; seed <= 90; seed++) {
      const templates = vocabulary(seed);
      const query = makeSign(SIGNS[seed % SIGNS.length], { duration: 900 + (seed % 7) * 400, count: 21 + (seed % 5) * 8,
        jitter: (seed % 3) * 0.002 });
      const expected = oracle(query, templates);
      expect(recognizePersonalTemplate(query, templates)).toEqual(expected);
      expect(await recognizePersonalTemplateAsync(query, templates, { sliceMs: 0 })).toEqual(expected);
      outcomes[expected ? "accepted" : "rejected"]++;
    }
    // The comparison is only meaningful if both outcomes are exercised.
    expect(outcomes.accepted).toBeGreaterThan(10);
    expect(outcomes.rejected).toBeGreaterThan(10);
  }, 120000);

  it("keeps the rival veto exact on both sides of the 0.06 margin", () => {
    const query = makeSign("HELLO", { duration: 3000, count: 61 });
    const exact = prepareCalibrationSequence(recentContinuousFrames(query, 4200, frame => frame.hands.some(validHand)));
    const shifted = (offset: number) => exact.map(row => row.map((value, k) => [0, 66, 132, 173].includes(k) ? value : value + offset));
    // Bisect for the offset whose rival sits at the requested distance.
    const rivalAt = (target: number) => {
      let low = 0, high = 1;
      for (let step = 0; step < 60; step++) {
        const middle = (low + high) / 2;
        if (sequenceDistance(exact, shifted(middle)) < target) low = middle; else high = middle;
      }
      return shifted(low);
    };
    const best = { id: "a", gloss: "BEST", text: "best", createdAt: 1, language: "asl" as const, frames: exact };
    for (const [distance, vetoed] of [[0.0595, true], [0.0605, false]] as const) {
      const rival = { id: "b", gloss: "RIVAL", text: "rival", createdAt: 2, language: "asl" as const, frames: rivalAt(distance) };
      for (const templates of [[best, rival], [rival, best]]) {
        const expected = oracle(query, templates);
        expect(expected === null).toBe(vetoed);
        expect(recognizePersonalTemplate(query, templates)).toEqual(expected);
      }
    }
  });

  it("still vetoes a rival that is close only in a later, longer window", () => {
    const query = makeSign("HELLO", { duration: 3000, count: 61 });
    const short = prepareCalibrationSequence(recentContinuousFrames(query, 650, frame => frame.hands.some(validHand)));
    const long = prepareCalibrationSequence(recentContinuousFrames(query, 4200, frame => frame.hands.some(validHand)));
    const shortMatch = { id: "a", gloss: "SHORT", text: "short", createdAt: 1, language: "asl" as const, frames: short };
    const longMatch = { id: "b", gloss: "LONG", text: "long", createdAt: 2, language: "asl" as const, frames: long };
    expect(oracle(query, [shortMatch])).not.toBeNull();
    expect(oracle(query, [shortMatch, longMatch])).toBeNull();
    expect(recognizePersonalTemplate(query, [shortMatch, longMatch])).toBeNull();
    expect(recognizePersonalTemplate(query, [longMatch, shortMatch])).toBeNull();
  });
});
