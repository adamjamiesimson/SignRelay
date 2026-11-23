import { describe, expect, it } from "vitest";
import { selectTakes } from "../lib/calibration-storage";
import type { CalibrationTemplate } from "../lib/vision-types";

const frames = Array.from({ length: 24 }, () => new Array(208).fill(0.1));
function direction(axis: number, noise = 0) {
  const values = new Array(8).fill(0).map((_, index) => (index === axis ? 1 : index === 3 ? noise : 0));
  const length = Math.hypot(...values);
  return values.map(value => value / length);
}
const take = (id: string, createdAt: number, embedding?: number[]): CalibrationTemplate =>
  ({ id, gloss: "PLEASE", text: "Please", createdAt, frames, ...(embedding ? { embedding } : {}) });

describe("which examples of a word are kept", () => {
  it("keeps everything while there is room", () => {
    const takes = [take("a", 1), take("b", 2)];
    expect(selectTakes(takes)).toHaveLength(2);
  });

  it("drops the sloppy take and keeps the newest one", () => {
    // Two takes agree on the sign; the third points elsewhere and would teach the wrong shape.
    const agree = direction(0);
    const takes = [take("old", 1, agree), take("older", 2, direction(0, 0.05)), take("new", 3, direction(0, 0.02)),
      take("sloppy", 4, direction(2))];
    const kept = selectTakes(takes.map(item => (item.id === "new" ? { ...item, createdAt: 9 } : item)));
    expect(kept).toHaveLength(3);
    expect(kept[0].id).toBe("new");
    expect(kept.map(item => item.id)).not.toContain("sloppy");
  });

  it("keeps the newest examples for records without embeddings", () => {
    const kept = selectTakes([take("a", 1), take("b", 2), take("c", 3), take("d", 4)]);
    expect(kept.map(item => item.id)).toEqual(["d", "c", "b"]);
  });

  it("never keeps more than the limit", () => {
    expect(selectTakes([1, 2, 3, 4, 5, 6].map(n => take(`t${n}`, n, direction(0, n / 100))))).toHaveLength(3);
  });
});
