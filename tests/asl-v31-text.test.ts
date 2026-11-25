import { describe, expect, it } from "vitest";
import { ABSENT_FROM_MODEL, displayTextForGloss, isModelClass, teachFirstSuggestions } from "../lib/asl-v31-text";

describe("how glosses are shown", () => {
  it("turns a label that joined two English words into the word people say", () => {
    // The pointing-at-yourself sign is recorded as one class for mine/my/me.
    expect(displayTextForGloss("MINEMY")).toBe("Me");
    expect(displayTextForGloss("WEUS")).toBe("We");
    expect(displayTextForGloss("HESHEIT")).toBe("He/She");
    expect(displayTextForGloss("HAVETO")).toBe("Have to");
  });

  it("keeps compound concepts whole", () => {
    expect(displayTextForGloss("BATHROOM")).toBe("Bathroom");
    expect(displayTextForGloss("COWBOY")).toBe("Cowboy");
  });

  it("separates hyphenated glosses and is case-insensitive", () => {
    expect(displayTextForGloss("THANK-YOU")).toBe("Thank You");
    expect(displayTextForGloss(" minemy ")).toBe("Me");
  });

  it("names the words the model cannot produce, so a signer is not left guessing", () => {
    expect(ABSENT_FROM_MODEL).toContain("YOU");
    expect(ABSENT_FROM_MODEL).toContain("HAPPY");
  });

  it("tells model-backed words from taught-only words against the real class list", () => {
    expect(isModelClass("please")).toBe(true);
    expect(isModelClass("MINEMY")).toBe(true);
    expect(isModelClass("YOU")).toBe(false);
    expect(isModelClass("HAPPY")).toBe(false);
  });

  it("suggests teaching the everyday words the model lacks, and only those", () => {
    const suggestions = teachFirstSuggestions();
    expect(suggestions).toContain("YOU");
    expect(suggestions).toContain("HAPPY");
    expect(suggestions).not.toContain("PLEASE");
    // every suggestion really is absent from the model, and a word the model gains later drops out
    for (const word of suggestions) expect(isModelClass(word)).toBe(false);
  });

  it("reads joined labels the way people say them", () => {
    expect(displayTextForGloss("CALLONPHONE")).toBe("Call on phone");
  });
});
