import { describe, expect, it } from "vitest";
import { AMBIGUITY_MARGIN, buildLanguageModel, predictNext, probabilityOfNext, resolveAmbiguity } from "../lib/asl-next-word";
import { ASL_SENTENCE_PATTERNS } from "../lib/asl-sentence-patterns";

const model = buildLanguageModel(ASL_SENTENCE_PATTERNS);

describe("next-word prediction", () => {
  it("predicts a word that follows the transcript", () => {
    const offered = predictNext(model, ["ME", "WANT"], { limit: 4 }).map(item => item.gloss);
    expect(offered).toContain("WATER");
    // Things nobody wants next are not offered above things people do want next.
    const neverNext = predictNext(model, ["ME", "WANT"], { limit: 40 }).map(item => item.gloss);
    expect(neverNext.indexOf("WATER")).toBeLessThan(neverNext.indexOf("HIGH") === -1 ? Infinity : neverNext.indexOf("HIGH"));
  });

  it("uses the wider context, not just the last word", () => {
    // "YOU NAME" can only end in WHAT; "ME NAME" is split between a finger-spelling and WHAT.
    const after = predictNext(model, ["YOU", "NAME"], { limit: 2 });
    expect(after[0].gloss).toBe("WHAT");
    expect(after[0].probability).toBeGreaterThan(0.5);
    expect(probabilityOfNext(model, ["YOU", "NAME"], "WHAT")).toBeGreaterThan(probabilityOfNext(model, ["ME", "NAME"], "WHAT") * 0.5);
  });

  it("only offers words the signer can actually sign", () => {
    const vocabulary = new Set(["WATER", "PLEASE"]);
    const offered = predictNext(model, ["ME", "WANT"], { vocabulary, limit: 5 });
    expect(offered.every(item => vocabulary.has(item.gloss))).toBe(true);
    expect(offered.map(item => item.gloss)).toContain("WATER");
  });

  it("returns probabilities that fall as the list goes on", () => {
    const offered = predictNext(model, ["THANK", "YOU"], { limit: 4 });
    const values = offered.map(item => item.probability);
    expect(values).toEqual([...values].sort((a, b) => b - a));
    expect(values[0]).toBeLessThanOrEqual(1);
  });

  it("still predicts at the start of a transcript", () => {
    expect(predictNext(model, [], { limit: 3 })).toHaveLength(3);
  });

  it("leaves a clear detector verdict alone", () => {
    const ranked = resolveAmbiguity(model, ["ME", "WANT"], [{ gloss: "WATER", probability: 0.8 }, { gloss: "HIGH", probability: 0.3 }]);
    expect(ranked[0].gloss).toBe("WATER");
    expect(ranked[0].reason).toBeUndefined();
  });

  it("overturns a coin-flip verdict when the sentence clearly prefers the runner-up", () => {
    // Both candidates are within the margin, so the detector is guessing between them.
    const close = [{ gloss: "HIGH", probability: 0.41 }, { gloss: "WATER", probability: 0.38 }];
    expect(close[0].probability - close[1].probability).toBeLessThanOrEqual(AMBIGUITY_MARGIN);
    const ranked = resolveAmbiguity(model, ["ME", "WANT"], close);
    expect(ranked[0].gloss).toBe("WATER");
    expect(ranked[0].reason).toBe("context");
    expect(ranked).toHaveLength(2);
  });

  it("does not overrule the detector when the sentence has no opinion", () => {
    // NEITHER-WORD is unknown to the corpus, so the model must not rank it.
    const close = [{ gloss: "BOY", probability: 0.41 }, { gloss: "ZEBRA-CROSSING", probability: 0.38 }];
    const ranked = resolveAmbiguity(model, ["ME", "WANT"], close);
    expect(ranked[0].gloss).toBe("BOY");
    expect(ranked[0].reason).toBeUndefined();
  });

  it("keeps every candidate, only reordering", () => {
    const close = [{ gloss: "HIGH", probability: 0.4 }, { gloss: "WATER", probability: 0.35 }, { gloss: "STOP", probability: 0.1 }];
    const ranked = resolveAmbiguity(model, ["ME", "WANT"], close);
    expect(ranked.map(item => item.gloss).sort()).toEqual(["HIGH", "STOP", "WATER"]);
  });
});
