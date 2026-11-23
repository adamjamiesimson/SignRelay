import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ASL_DEMO_WORDS } from "../lib/capability-status";
import { DEMO_SEQUENCE } from "../lib/hand-illustration";

describe("landing illustration honesty", () => {
  it("only illustrates the six demo words and includes an abstention", () => {
    const signs = DEMO_SEQUENCE.filter(item => item.confirmed).map(item => item.sign);
    expect(signs.every(sign => (ASL_DEMO_WORDS as readonly string[]).includes(sign))).toBe(true);
    expect(DEMO_SEQUENCE.some(item => !item.confirmed)).toBe(true);
  });
  it("is labelled as an illustration and shows no invented confidence figures", () => {
    const source = readFileSync("components/hero-preview.tsx", "utf8");
    expect(source).toMatch(/Illustration · Not live/i);
    expect(source).not.toMatch(/confidence: \d+|\{item\.confidence\}|LIVE · ASL<|RECOGNIZING</);
  });
});
