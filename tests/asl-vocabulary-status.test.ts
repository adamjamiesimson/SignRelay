import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ASL_VOCABULARY_COUNTS, aslSignTier, experimentalAslSigns } from "../lib/asl-vocabulary-status";
import { capabilityStatus } from "../lib/capability-status";
import { vocabularyLabel } from "../components/language-picker";
import { MODEL_ADAPTERS, WLASL2000_GLOSSES } from "../lib/model-adapters";

const status = JSON.parse(readFileSync("public/models/asl2000-tgcn/vocabulary-status.json", "utf8"));

describe("ASL vocabulary status", () => {
  it("separates installed labels from experimental and validated words", () => {
    expect(ASL_VOCABULARY_COUNTS.installed).toBe(WLASL2000_GLOSSES.length);
    expect(ASL_VOCABULARY_COUNTS.experimental).toBe(status.experimental.length);
    expect(ASL_VOCABULARY_COUNTS.validated).toBe(status.validated.length);
    expect(ASL_VOCABULARY_COUNTS.validated).toBeLessThanOrEqual(ASL_VOCABULARY_COUNTS.experimental);
    const tiers = WLASL2000_GLOSSES.map(aslSignTier);
    expect(tiers.filter(tier => tier === "installed").length).toBe(WLASL2000_GLOSSES.length - status.experimental.length);
  });

  it("marks a word experimental only with recorded correct recognitions on unseen signers", () => {
    for (const entry of experimentalAslSigns()) {
      expect(WLASL2000_GLOSSES).toContain(entry.gloss);
      expect((entry.endToEnd?.correct ?? 0) + (entry.isolated?.acceptedCorrect ?? 0)).toBeGreaterThan(0);
    }
    for (const gloss of status.validated) expect(aslSignTier(gloss)).toBe("validated");
  });

  it("never presents the installed label count as recognised signs", () => {
    expect(vocabularyLabel(MODEL_ADAPTERS.asl)).toMatch(/labels/);
    expect(vocabularyLabel(MODEL_ADAPTERS.asl)).not.toMatch(/2,000 signs/);
    expect(capabilityStatus("asl").headline).toContain("installed labels");
  });
});
