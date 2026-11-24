import { describe, expect, it } from "vitest";
import { LANGUAGE_IDS } from "../lib/model-adapters";
import { NEXT_WORD_LANGUAGES, nextWordModel } from "../lib/next-word-corpus";
import { predictNext } from "../lib/asl-next-word";

describe("which languages can predict the next word", () => {
  it("offers predictions for ASL, whose gloss grammar the corpus is written in", () => {
    const model = nextWordModel("asl");
    expect(model).not.toBeNull();
    expect(predictNext(model!, ["ME", "WANT"], { limit: 1 })).toHaveLength(1);
  });

  it("withholds them everywhere else rather than answering in the wrong language", () => {
    // A Russian, Bangla or Spanish transcript must not receive English ASL gloss suggestions.
    for (const language of ["rsl", "bdsl", "lse", "bsl", "isl", "psl"] as const) {
      expect(nextWordModel(language)).toBeNull();
    }
  });

  it("names the languages it supports, and every name is a real language id", () => {
    expect(NEXT_WORD_LANGUAGES).toEqual(["asl"]);
    for (const language of NEXT_WORD_LANGUAGES) expect(LANGUAGE_IDS).toContain(language);
  });

  it("builds a language's model once and reuses it", () => {
    expect(nextWordModel("asl")).toBe(nextWordModel("asl"));
  });
});
