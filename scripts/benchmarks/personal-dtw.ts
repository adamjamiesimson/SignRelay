import { performance } from "node:perf_hooks";
import { recognizePersonalTemplate, prepareCalibrationSequence, sequenceDistance } from "../../lib/personalized-recognition";
import { recentContinuousFrames } from "../../lib/frame-timing";
import { validHand } from "../../lib/asl-starter-recognition";
import { makeSign } from "../../tests/fixtures/asl-motion";
import type { CalibrationTemplate, VisionFrame } from "../../lib/vision-types";

/** Independent reconstruction of the original full-matrix matcher from main.
 * Synthetic landmarks only; these timings are not sign-language accuracy.
 */
function oldDistance(a: number[][], b: number[][]) {
  if (!a.length || !b.length) return Infinity;
  const canonical = (seq: number[][]) => seq.map(row => row.length === 208 ? [...row, ...new Array(32).fill(0)] : row);
  a = canonical(a); b = canonical(b);
  const n = a[0].length;
  if (!n || [...a, ...b].some(row => row.length !== n || row.some(value => !Number.isFinite(value)))) return Infinity;
  const matrix = Array.from({ length: a.length + 1 }, () => new Float64Array(b.length + 1).fill(Infinity));
  matrix[0][0] = 0;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      let total = 0, compared = 0;
      for (let k = 0; k < n; k++) {
        if (n === 240) {
          const group = k < 66 ? 0 : k < 132 ? 66 : k < 173 ? 132 : 173;
          if (group >= 132 ? (!a[i - 1][group] || !b[j - 1][group]) : (!a[i - 1][group] && !b[j - 1][group])) continue;
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

function originalMatch(frames: VisionFrame[], templates: CalibrationTemplate[]) {
  const now = frames.at(-1)?.timestamp;
  if (!templates.length || frames.length < 8 || now === undefined || !frames.at(-1)?.hands.some(validHand)) return null;
  const matches = new Map<string, { template: CalibrationTemplate; distance: number }>();
  let previousLength = 0;
  for (const duration of [650, 1200, 2000, 3000, 4200]) {
    const recent = recentContinuousFrames(frames, duration, frame => frame.hands.some(validHand));
    if (recent.length === previousLength) continue;
    previousLength = recent.length;
    if (recent.length < 8 || recent.filter(frame => frame.hands.some(validHand)).length / recent.length < 0.7) continue;
    const candidate = prepareCalibrationSequence(recent);
    for (const template of templates) {
      if (template.frames.length !== 24) continue;
      const distance = oldDistance(candidate, template.frames);
      if (distance < (matches.get(template.gloss)?.distance ?? Infinity)) matches.set(template.gloss, { template, distance });
    }
  }
  const [best, rival] = [...matches.values()].sort((a, b) => a.distance - b.distance);
  if (!best || best.distance > 0.5 || (rival && rival.distance - best.distance < 0.06)) return null;
  return { label: best.template.gloss, text: best.template.text, confidence: Math.min(0.96, Math.max(0, 0.965 - best.distance * 0.24)) };
}

function examples(count: number, mode: "easy" | "hard", base: number[][]) {
  return Array.from({ length: count }, (_, i): CalibrationTemplate => {
    // "hard" all plausible close rivals, "easy" most clearly different.
    const offset = i === 0 ? 0 : mode === "easy" ? 1.25 + i % 3 * 0.15 : 0.01 + (i % 5) * 0.018;
    const frames = base.map(row => row.map((value, k) =>
      [0, 66, 132, 173].includes(k) ? value : value + offset));
    return { id: "t" + i, gloss: "WORD" + i, text: "Word " + i, createdAt: i + 1, language: "asl", frames };
  });
}
function elapsed(task: () => unknown) { const start = performance.now(); const result = task(); return { ms: +(performance.now() - start).toFixed(2), result }; }
function same(a: unknown, b: unknown) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error("Recognition decision diverged: " + JSON.stringify({ a, b }));
}

const sample = makeSign("HELLO", { duration: 3000, count: 61 });
const base = prepareCalibrationSequence(makeSign("HELLO", { duration: 1800, count: 37 }));
const rows: object[] = [];
for (const mode of ["easy", "hard"] as const) for (const count of [30, 150, 300]) {
  const templates = examples(count, mode, base);
  // Cache cold-load initialization once without giving either version an unfair
  // advantage during the measured sequence.
  const original = elapsed(() => originalMatch(sample, templates));
  const optimized = elapsed(() => recognizePersonalTemplate(sample, templates));
  same(original.result, optimized.result);
  const optimizedWarm = elapsed(() => recognizePersonalTemplate(sample, templates));
  same(original.result, optimizedWarm.result);
  const row = {
    benchmark: "personal", mode, examples: count,
    old_ms: original.ms, new_cold_ms: optimized.ms,
    new_warm_ms: optimizedWarm.ms,
    speedup_warm: +(original.ms / Math.max(optimizedWarm.ms, 0.01)).toFixed(2),
    decision_equal: true,
  };
  rows.push(row);
  console.log("BENCHMARK " + JSON.stringify(row));
}
// Compare only PSL's distance computation here, not asset load / browser event
// loop yield overhead. 775 classes is the built-in reference set size.
for (const mode of ["easy", "hard"] as const) {
  const templates = examples(775, mode, base);
  const oldResult = elapsed(() => templates.map(t => oldDistance(base, t.frames)));
  const newResult = elapsed(() => templates.map(t => sequenceDistance(base, t.frames, 0.56)));
  for (let i = 0; i < templates.length; i++) {
    const expected = (oldResult.result as number[])[i];
    const actual = (newResult.result as number[])[i];
    if (expected <= 0.56 && Math.abs(expected - actual) > 1e-8) {
      throw new Error("PSL cutoff removed a potentially relevant distance");
    }
    if (expected > 0.56 && actual !== Infinity && Math.abs(expected - actual) > 1e-8) {
      throw new Error("PSL returned inconsistent distance");
    }
  }
  const row = {
    benchmark: "psl-distance-only", mode, examples: 775,
    old_ms: oldResult.ms, new_ms: newResult.ms,
    speedup: +(oldResult.ms / Math.max(newResult.ms, 0.01)).toFixed(2),
    decision_equal: true,
  };
  rows.push(row);
  console.log("BENCHMARK " + JSON.stringify(row));
}
console.log("BENCHMARK_SUMMARY " + JSON.stringify(rows));
