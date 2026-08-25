import { describe, expect, it } from "vitest";
import { isRecentDuplicate, shouldConfirm } from "../lib/decoder";

describe("confidence-gated decoding", () => {
  it("never confirms below the configured threshold", () => {
    expect(shouldConfirm({
      confidence: 0.81,
      threshold: 0.82,
      streak: 4,
      sameLabel: false,
      elapsedSinceLast: 10_000,
      cooldown: 2600,
    })).toBe(false);
  });

  it("requires temporal consensus across evaluations", () => {
    expect(shouldConfirm({
      confidence: 0.91,
      threshold: 0.82,
      streak: 1,
      sameLabel: false,
      elapsedSinceLast: 10_000,
      cooldown: 2600,
    })).toBe(false);
  });

  it("allows a strong, stable prediction", () => {
    expect(shouldConfirm({
      confidence: 0.91,
      threshold: 0.82,
      streak: 2,
      sameLabel: false,
      elapsedSinceLast: 0,
      cooldown: 2600,
    })).toBe(true);
  });

  it("suppresses repeated held signs during cooldown", () => {
    expect(shouldConfirm({
      confidence: 0.94,
      threshold: 0.82,
      streak: 3,
      sameLabel: true,
      elapsedSinceLast: 1200,
      cooldown: 2600,
    })).toBe(false);
  });
});

describe("transcript duplicate suppression", () => {
  it("rejects the same gloss repeated inside the transcript window", () => {
    expect(isRecentDuplicate(
      { gloss: "HELLO", timestamp: 1000 },
      { gloss: "HELLO", timestamp: 2600 },
    )).toBe(true);
  });

  it("keeps a different gloss", () => {
    expect(isRecentDuplicate(
      { gloss: "HELLO", timestamp: 1000 },
      { gloss: "YES", timestamp: 1600 },
    )).toBe(false);
  });
});
