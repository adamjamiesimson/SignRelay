import { describe, expect, it } from "vitest";
import { ABSENT_FROM_MODEL, displayTextForGloss } from "../lib/asl-v31-text";

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
});
