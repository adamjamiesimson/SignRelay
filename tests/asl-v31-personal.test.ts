import { describe, expect, it } from "vitest";
import { cosineSimilarity, enrolmentReport, ENROLMENT_MIN_SELF_SIMILARITY, matchPersonalEmbedding,
  PERSONAL_EMBEDDING_MIN_MARGIN, PERSONAL_EMBEDDING_MIN_SIMILARITY } from "../lib/asl-v31-personal";
import type { CalibrationTemplate } from "../lib/vision-types";

/** Unit-length embedding along one axis, with a little energy elsewhere so similarity is realistic. */
function direction(axis: number, mix = 0, other = 1) {
  const values = new Array(8).fill(0).map((_, index) => (index === axis ? 1 : index === other ? mix : 0));
  const length = Math.hypot(...values);
  return values.map(value => value / length);
}
const template = (gloss: string, embedding?: number[]): CalibrationTemplate =>
  ({ id: gloss, language: "asl", gloss, text: gloss, createdAt: 0, frames: [], ...(embedding ? { embedding } : {}) });

describe("taught-sign embedding match", () => {
  it("matches a sign this signer taught, using the similarity the live camera produced", () => {
    // Measured on a live signer: repeats of the same sign scored 0.93, every other sign <= 0.27.
    const taught = template("PLEASE", direction(0));
    const live = direction(0, 0.4).map((value, index) => value + (index === 3 ? 0.05 : 0));
    const match = matchPersonalEmbedding(live, [taught, template("YES", direction(1))]);
    expect(match?.template.gloss).toBe("PLEASE");
    expect(match!.similarity).toBeGreaterThan(PERSONAL_EMBEDDING_MIN_SIMILARITY);
  });

  it("keeps the model's answer when nothing was taught this close", () => {
    expect(matchPersonalEmbedding(direction(2), [template("PLEASE", direction(0)), template("YES", direction(1))])).toBeNull();
  });

  it("refuses two taught signs that are too close to separate", () => {
    // A gesture halfway between two taught signs must not silently pick one.
    const between = direction(0).map((value, index) => value + direction(1)[index]);
    expect(matchPersonalEmbedding(between, [template("PLEASE", direction(0)), template("YES", direction(1))])).toBeNull();
  });

  it("treats a second take of the same word as confirmation, not ambiguity", () => {
    const match = matchPersonalEmbedding(direction(0, 0.05), [template("PLEASE", direction(0)), template("PLEASE", direction(0, 0.02))]);
    expect(match?.template.gloss).toBe("PLEASE");
    expect(PERSONAL_EMBEDDING_MIN_MARGIN).toBeGreaterThan(0);
  });

  it("pools several takes of one word so a single loose take cannot outvote a good one", () => {
    // Take A is the word; take B is a sloppy recording that leans towards another direction.
    const good = direction(0);
    const sloppy = direction(0, 0.6).map((value, index) => value + (index === 1 ? 0.35 : 0));
    const match = matchPersonalEmbedding(direction(0), [template("PLEASE", good), template("PLEASE", sloppy)]);
    expect(match?.template.gloss).toBe("PLEASE");
    expect(match!.similarity).toBeGreaterThan(0.99);
  });

  it("reports the first take, a consistent repeat, a take that disagrees and a collision", () => {
    const teaching = [template("PLEASE", direction(0))];
    expect(enrolmentReport(direction(0), "PLEASE", []).verdict).toBe("first");

    const repeat = enrolmentReport(direction(0, 0.05), "PLEASE", teaching);
    expect(repeat.verdict).toBe("consistent");
    expect(repeat.sameBest).toBeGreaterThan(ENROLMENT_MIN_SELF_SIMILARITY);

    // A recording that points somewhere else is not the same sign, and would weaken the dictionary.
    expect(enrolmentReport(direction(2), "PLEASE", teaching).verdict).toBe("differs");

    // A second word recorded almost exactly like PLEASE could never be told apart at match time.
    const collision = enrolmentReport(direction(0, 0.02), "STOP", teaching);
    expect(collision.verdict).toBe("collides");
    expect(collision.conflict?.gloss).toBe("PLEASE");
    expect(collision.conflict!.similarity).toBeGreaterThanOrEqual(PERSONAL_EMBEDDING_MIN_SIMILARITY);
  });

  it("ignores templates recorded before embeddings existed and corrupt stored values", () => {
    expect(matchPersonalEmbedding(direction(0), [template("LEGACY")])).toBeNull();
    expect(matchPersonalEmbedding(direction(0), [template("BROKEN", [1, Number.NaN])])).toBeNull();
    expect(matchPersonalEmbedding(null, [template("PLEASE", direction(0))])).toBeNull();
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
  });
});
