import { describe, expect, it } from "vitest";
import { ASL_ALPHABET, FINGERSPELLING_MODEL, LetterConfirmation, editSpelling, letterAt } from "../lib/fingerspelling";

const policy = { minScore: .9, dwellMs: 400, minSamples: 3, maxGapMs: 250, maxAgeMs: 200 };
const evidence = (letter: string, time: number, extra = {}) => ({ letter, time, score: .95, hand: "Right" as const, motionComplete: false, ...extra });
const make = (letters: readonly string[] = ASL_ALPHABET) => new LetterConfirmation(policy, letters);
function hold(c: LetterConfirmation, letter: string, start = 0, extra = {}) {
  for (const t of [0, 200, 400]) c.observe(evidence(letter, start + t, extra));
}
describe("alphabet metadata (not recognition coverage)", () => {
  it("defines exactly 26 distinct labels in order", () => {
    expect(ASL_ALPHABET.join("")).toBe("ABCDEFGHIJKLMNOPQRSTUVWXYZ");
    expect(new Set(ASL_ALPHABET).size).toBe(26);
    ASL_ALPHABET.forEach((letter, index) => expect(letterAt(index, ASL_ALPHABET)).toBe(letter));
  });
  it.each([-1, 26, .5, NaN, Infinity])("rejects invalid output index %s", index => {
    expect(letterAt(index, ASL_ALPHABET)).toBeNull();
  });
  it("uses the model's label order and rejects control/word labels", () => {
    expect(letterAt(0, ["Z", "A"])).toBe("Z");
    expect(letterAt(1, ["Z", "A"])).toBe("A");
    expect(letterAt(0, ["HELLO"])).toBeNull();
    expect(letterAt(0, ["blank"])).toBeNull();
  });
  it("keeps the unvalidated frame-letter controller disabled beside the sequence pilot", () => {
    expect(FINGERSPELLING_MODEL.status).toBe("experimental-sequence");
    expect(FINGERSPELLING_MODEL.supportedLetters).toEqual([]);
    const c = make(FINGERSPELLING_MODEL.supportedLetters);
    for (const letter of ASL_ALPHABET) { hold(c, letter); expect(c.commit(400)).toBeNull(); }
  });
});
describe("deliberate temporal confirmation with synthetic classifier evidence", () => {
  it("needs elapsed time and independent samples", () => {
    const c = make(); c.observe(evidence("H", 0)); expect(c.commit(0)).toBeNull();
    c.observe(evidence("H", 200)); expect(c.commit(200)).toBeNull();
    c.observe(evidence("H", 400)); expect(c.ready(400)).toBe(true);
    expect(c.commit(400)).toBe("H"); expect(c.commit(400)).toBeNull();
  });
  it("does not combine a transition with the new letter's dwell", () => {
    const c = make(); hold(c, "H"); c.observe(evidence("E", 450));
    expect(c.commit(450)).toBeNull();
  });
  it("supports HELLO with separate intentional commits including LL", () => {
    const c = make(); let text = "";
    for (const [i, letter] of [..."HELLO"].entries()) {
      hold(c, letter, i * 600); text += c.commit(i * 600 + 400) ?? "";
      expect(c.commit(i * 600 + 400)).toBeNull();
    }
    expect(text).toBe("HELLO");
  });
  it("a held hand never inserts automatically", () => {
    const c = make(); hold(c, "L");
    for (let t = 600; t < 10000; t += 200) c.observe(evidence("L", t));
    expect(c.commit(9800)).toBe("L"); expect(c.commit(9800)).toBeNull();
  });
  it("blank/no-hand frames discard evidence", () => {
    const c = make(); hold(c, "A"); c.observe(null); expect(c.commit(400)).toBeNull();
  });
  it("requires fresh evidence after a long gap, reset, or hand change", () => {
    const c = make(); hold(c, "A"); c.observe(evidence("A", 1000)); expect(c.commit(1000)).toBeNull();
    hold(c, "B", 2000); c.reset(); expect(c.commit(2400)).toBeNull();
    hold(c, "C", 3000); c.observe(evidence("C", 3450, { hand: "Left" })); expect(c.commit(3450)).toBeNull();
  });
  it.each(["J", "Z"])("%s cannot be confirmed from a static output", letter => {
    const c = make(); hold(c, letter); expect(c.commit(400)).toBeNull();
    hold(c, letter, 1000, { motionComplete: true }); expect(c.commit(1400)).toBe(letter);
  });
  it("random low-score transitions never qualify", () => {
    const c = make();
    for (let t = 0; t < 1000; t += 50) {
      c.observe(evidence(ASL_ALPHABET[(t / 50) % 26], t, { score: .2 }));
      expect(c.commit(t)).toBeNull();
    }
  });
  it.each([NaN, Infinity, -.1, 1.1, .89])("rejects invalid/insufficient score %s", score => {
    const c = make(); hold(c, "A"); c.observe(evidence("A", 450, { score }));
    expect(c.commit(450)).toBeNull();
  });
  it("rejects stale, future and nonmonotonic evidence", () => {
    const c = make(); hold(c, "A");
    expect(c.commit(601)).toBeNull(); expect(c.commit(399)).toBeNull(); expect(c.commit(NaN)).toBeNull();
    c.observe(evidence("A", 300)); expect(c.commit(400)).toBeNull();
  });
  it("does not let duplicate timestamps manufacture sample count", () => {
    const c = make(); c.observe(evidence("A", 0)); c.observe(evidence("A", 0)); c.observe(evidence("A", 400));
    expect(c.commit(400)).toBeNull();
  });
  it("rejects malformed policies", () => {
    expect(() => new LetterConfirmation({ ...policy, dwellMs: 0 }, ASL_ALPHABET)).toThrow();
    expect(() => new LetterConfirmation({ ...policy, minScore: NaN }, ASL_ALPHABET)).toThrow();
  });
});
describe("text composition", () => {
  it("edits spaces and repeated letters without touching other drafts", () => {
    expect(editSpelling("HELL", "backspace")).toBe("HEL");
    expect(editSpelling("HELLO", "space")).toBe("HELLO ");
    expect(editSpelling("HELLO", "clear")).toBe("");
    expect(editSpelling("", "backspace")).toBe("");
  });
  it("removes a Unicode code point and bounds appended text", () => {
    expect(editSpelling("A😀", "backspace")).toBe("A");
    expect(editSpelling("A".repeat(2000), "space")).toHaveLength(2000);
  });
});
