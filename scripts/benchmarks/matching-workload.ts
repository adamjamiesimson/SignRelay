import { prepareCalibrationSequence } from "../../lib/personalized-recognition";
import { makeSign } from "../../tests/fixtures/asl-motion";
import type { CalibrationTemplate } from "../../lib/vision-types";
export { makeSign };
export { recognizePsl776 } from "../../lib/psl776-runtime";
export function examples(count: number): CalibrationTemplate[] {
  const base = prepareCalibrationSequence(makeSign("HELLO", { duration: 1800, count: 37 }));
  return Array.from({ length: count }, (_, i) => ({
    id: `t${i}`, gloss: `WORD${Math.floor(i / 3)}`, text: `Word ${Math.floor(i / 3)}`,
    createdAt: i + 1, language: "csl", frames: base.map(row => row.map((value, k) =>
      [0, 66, 132, 173].includes(k) ? value : value + (i ? 0.01 + i % 5 * 0.018 : 0))),
  }));
}
