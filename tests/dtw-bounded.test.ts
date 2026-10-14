import { describe, expect, it } from "vitest";
import { sequenceDistance } from "../lib/personalized-recognition";

// Deliberately independent, slow reference implementing the pre-optimization
// 2-D dynamic-programming matrix. Comparisons protect exact DTW semantics.
function reference(a: number[][], b: number[][]) {
  const canonical = (rows: number[][]) => rows.map(row => row.length === 208
    ? [...row, ...new Array(32).fill(0)] : row);
  a = canonical(a); b = canonical(b);
  const count = a[0].length;
  const matrix = Array.from({ length: a.length + 1 }, () =>
    new Float64Array(b.length + 1).fill(Infinity));
  matrix[0][0] = 0;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      let total = 0, compared = 0;
      for (let k = 0; k < count; k++) {
        if (count === 240) {
          const group = k < 66 ? 0 : k < 132 ? 66 : k < 173 ? 132 : 173;
          if (group >= 132 ? (!a[i - 1][group] || !b[j - 1][group])
            : (!a[i - 1][group] && !b[j - 1][group])) continue;
        }
        const delta = a[i - 1][k] - b[j - 1][k];
        total += Math.min(delta * delta, 4);
        compared++;
      }
      const cost = compared ? Math.sqrt(total / compared) : Infinity;
      matrix[i][j] = cost + Math.min(matrix[i - 1][j], matrix[i][j - 1], matrix[i - 1][j - 1]);
    }
  }
  return matrix[a.length][b.length] / Math.max(a.length, b.length);
}

function sequence(seed: number, length: number, dimensions = 240) {
  return Array.from({ length }, (_, i) => Array.from({ length: dimensions }, (_, k) => {
    if ([0, 66, 132, 173].includes(k)) return (seed + i) % 5 === 0 ? 0 : 1;
    return ((seed * 19 + i * 7 + k * 11) % 100) / 100;
  }));
}

describe("bounded rolling DTW preserves recognition decisions", () => {
  it("exactly reproduces the previous unbounded DP on different lengths and legacy features", () => {
    for (const dimensions of [208, 240]) for (const length of [8, 16, 24]) {
      for (let seed = 1; seed <= 4; seed++) {
        const a = sequence(seed, length, dimensions);
        const b = sequence(seed + 3, 24, dimensions);
        expect(sequenceDistance(a, b)).toBeCloseTo(reference(a, b), 12);
      }
    }
  });
  it("preserves all scores within the 0.56 acceptance/ambiguity window", () => {
    for (let seed = 0; seed < 12; seed++) {
      const a = sequence(seed, 24);
      const b = sequence(seed + 1, 24);
      const expected = reference(a, b);
      const bounded = sequenceDistance(a, b, 0.56);
      if (expected > 0.56) expect(bounded).toBe(Infinity);
      else expect(bounded).toBeCloseTo(expected, 12);
    }
  });
  it("prunes candidates too distant to win or veto a valid recognition", () => {
    const a = Array.from({ length: 24 }, () => new Array(240).fill(1));
    const near = a.map(row => [...row]);
    const far = a.map(row => row.map(value => value + 1));
    expect(sequenceDistance(a, near, 0.56)).toBe(0);
    expect(sequenceDistance(a, far, 0.56)).toBe(Infinity);
    expect(sequenceDistance(a, far)).toBeGreaterThan(0.56);
  });
  it("rejects corrupt and malformed arrays rather than inventing a match", () => {
    const a = sequence(1, 24);
    const invalid = sequence(2, 24);
    invalid[10][7] = Number.NaN;
    expect(sequenceDistance(a, invalid, 0.56)).toBe(Infinity);
    expect(sequenceDistance(a, [[1]], 0.56)).toBe(Infinity);
  });
});
