import { describe, expect, it } from "vitest";
import { capturePlan, captureTrial, slotLabels, takeCount, videoExtension } from "../lib/field-test-capture";

describe("private development recording slot IDs", () => {
  it("matches the frozen 144-slot collection plan without making observed recordings", () => {
    let count = 0;
    for (let p = 0; p < capturePlan.participant_ids.length; p++) {
      for (const type of ["sign", "no_sign", "unknown_sign"] as const) {
        for (let slot = 1; slot <= slotLabels(type).length; slot++) {
          for (let take = 1; take <= takeCount(type); take++) {
            const trial = captureTrial(p, type, slot, take);
            expect(trial.trial_id).toBe(capturePlan.participant_ids[p] + "-" + type + "-" + slot + "-" + take);
            expect(trial.evaluation_split).toBe("development");
            if (type !== "sign") expect(trial.expected_gloss).toBeNull();
            count++;
          }
        }
      }
    }
    expect(count).toBe(capturePlan.planned_counts.total);
    expect(count).toBe(144);
  });
  it("refuses non-plan participants, slots and takes", () => {
    expect(() => captureTrial(-1, "sign", 1, 1)).toThrow("participant");
    expect(() => captureTrial(4, "sign", 1, 1)).toThrow("participant");
    expect(() => captureTrial(0, "sign", 7, 1)).toThrow("slot");
    expect(() => captureTrial(0, "no_sign", 1, 3)).toThrow("take");
    expect(() => captureTrial(0, "unknown_sign", 4, 1)).toThrow("slot");
  });
  it("never mislabels browser WebM as MP4", () => {
    expect(videoExtension("video/webm;codecs=vp8")).toBe("webm");
    expect(videoExtension("video/mp4")).toBe("mp4");
  });
});
