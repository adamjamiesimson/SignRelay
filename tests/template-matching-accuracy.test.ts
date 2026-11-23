import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { compileDistanceSequence, cachedTemplateSequence, compiledSequenceDistance,
  prepareCalibrationSequence, recognizePersonalTemplate, recognizePersonalTemplateAsync,
} from "../lib/personalized-recognition";
import { matchPslTemplates, type Psl776Template } from "../lib/psl776-runtime";
import { makeSign } from "./fixtures/asl-motion";

// Independent original full-matrix metric, not the optimized implementation.
function reference(a: number[][], b: number[][]) {
  const matrix = Array.from({ length: a.length + 1 }, () => new Float64Array(b.length + 1).fill(Infinity));
  matrix[0][0] = 0;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    let total = 0, count = 0;
    for (let k = 0; k < 240; k++) {
      const group = k < 66 ? 0 : k < 132 ? 66 : k < 173 ? 132 : 173;
      if (group >= 132 ? (!a[i - 1][group] || !b[j - 1][group]) : (!a[i - 1][group] && !b[j - 1][group])) continue;
      const delta = a[i - 1][k] - b[j - 1][k]; total += Math.min(delta * delta, 4); count++;
    }
    matrix[i][j] = (count ? Math.sqrt(total / count) : Infinity) + Math.min(matrix[i - 1][j], matrix[i][j - 1], matrix[i - 1][j - 1]);
  }
  return matrix[a.length][b.length] / Math.max(a.length, b.length);
}

describe("asynchronous matcher accuracy safeguards (not real-video accuracy)", () => {
  it("preserves personal windows, legacy features, same-gloss examples and rival rejection", async () => {
    const frames = makeSign("HELLO");
    const saved = { id: "a", gloss: "HELLO", text: "Hello", createdAt: 1,
      frames: prepareCalibrationSequence(frames).map(row => row.slice(0, 208)) };
    for (const templates of [[saved], [saved, { ...saved, id: "b" }], [saved, { ...saved, id: "b", gloss: "HELP" }]]) {
      expect(await recognizePersonalTemplateAsync(frames, templates, { sliceMs: 0 })).toEqual(recognizePersonalTemplate(frames, templates));
    }
  });
  it("cancels at a compute boundary without publishing partial-best guesses", async () => {
    const frames = makeSign("HELLO"); const controller = new AbortController();
    const template = { id: "a", gloss: "HELLO", text: "Hello", createdAt: 1, frames: prepareCalibrationSequence(frames) };
    const task = recognizePersonalTemplateAsync(frames, Array(300).fill(template), { signal: controller.signal, sliceMs: 0 });
    controller.abort(); await expect(task).rejects.toMatchObject({ name: "AbortError" });
  });
  it("retains every relevant distance across the actual 775 installed PSL references", async () => {
    const templates = JSON.parse(gunzipSync(readFileSync("public/models/psl776-hfad/templates.json.gz")).toString()) as Psl776Template[];
    expect(templates).toHaveLength(775);
    const frames = makeSign("HELLO", { duration: 1800, count: 37 });
    const candidate = prepareCalibrationSequence(frames), prepared = compileDistanceSequence(candidate);
    const scores = templates.map(template => ({ template, distance: reference(candidate, template.frames) })).sort((a, b) => a.distance - b.distance);
    for (const { template, distance } of scores) {
      const actual = compiledSequenceDistance(prepared, cachedTemplateSequence(template.frames), 0.56);
      if (distance <= 0.56) expect(actual).toBeCloseTo(distance, 10);
      else if (actual !== Infinity) expect(actual).toBeCloseTo(distance, 10);
    }
    const [best, rival] = scores;
    const expected = best.distance <= 0.5 && rival.distance - best.distance >= 0.06 ? best.template.gloss : null;
    expect((await matchPslTemplates(frames, templates))?.label ?? null).toBe(expected);
  });
  it("rejects competing PSL references with identical motion and aborts a cancelled scan", async () => {
    const frames = makeSign("HELLO"), reference = prepareCalibrationSequence(frames);
    const templates = ["A", "B"].map(gloss => ({ gloss, text: gloss, frames: reference }));
    expect(await matchPslTemplates(frames, templates)).toBeNull();
    const controller = new AbortController(); controller.abort();
    await expect(matchPslTemplates(frames, templates, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  });
});
