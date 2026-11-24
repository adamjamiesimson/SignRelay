import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Keeps the rehearsal list honest: every candidate must be a real installed BSL-1K class,
// and words documented as missing must really be missing.
const labels = new Set(JSON.parse(readFileSync("public/models/bsl1064-pose2sign/labels.json", "utf8")) as string[]);
const doc = readFileSync("docs/bsl-sprint-2026-11-24/SHOWCASE_REHEARSAL.md", "utf8");

describe("BSL showcase candidate list", () => {
  const candidates = [...doc.matchAll(/^\| \d+ \| ([A-Z ]+) \|/gm)].map(match => match[1].trim());

  it("lists 10-20 signs, all from the installed 1,064-class vocabulary", () => {
    expect(candidates.length).toBeGreaterThanOrEqual(10);
    expect(candidates.length).toBeLessThanOrEqual(20);
    for (const label of candidates) expect(labels.has(label), label).toBe(true);
    expect(new Set(candidates).size).toBe(candidates.length);
  });

  it("only calls words missing when the model truly lacks them", () => {
    const missing = doc.match(/Not in the vocabulary \(do \*\*not\*\* demo with this model\): ([^.]+)\./)?.[1].split(",").map(word => word.trim()) ?? [];
    expect(missing.length).toBeGreaterThan(3);
    for (const word of missing) expect(labels.has(word), word).toBe(false);
  });
});
