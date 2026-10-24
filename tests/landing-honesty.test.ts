import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ASL_DEMO_WORDS } from "../lib/capability-status";
import { DEMO_SEQUENCE } from "../lib/hand-illustration";

describe("landing illustration honesty", () => {
  it("only illustrates the six demo words and includes an abstention", () => {
    const signs = DEMO_SEQUENCE.filter(item => item.confirmed).map(item => item.sign);
    expect(signs.every(sign => (ASL_DEMO_WORDS as readonly string[]).includes(sign))).toBe(true);
    expect([...new Set(signs)].sort()).toEqual([...ASL_DEMO_WORDS].sort());
    expect(DEMO_SEQUENCE.some(item => !item.confirmed)).toBe(true);
  });
  it("is labelled as an illustration and shows no invented confidence figures", () => {
    const source = readFileSync("components/hero-preview.tsx", "utf8");
    expect(source).toContain("Illustration · Not live");
    expect(source).not.toMatch(/confidence|\bscores?\b|accura|\d\s*%\s*</i);
    expect(source).not.toMatch(/LIVE · ASL<|RECOGNIZING/);
  });
  it("draws hands only: no face mesh or body skeleton", () => {
    const source = readFileSync("components/hero-preview.tsx", "utf8") + readFileSync("lib/hand-illustration.ts", "utf8");
    expect(source).not.toMatch(/face|shoulder|pose landmark|scan-line|faceDots/i);
  });
});
