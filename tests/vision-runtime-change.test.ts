import { describe, expect, it } from "vitest";
import { verifyRuntimeChange } from "../scripts/verify-vision-runtime-change.mjs";
import { TASKS_VERSION } from "../lib/vision-runtime.mjs";
import manifest from "../docs/evaluation/popsign-development-2026-10-16.json";
const baseline = { js: "0.10.35", wasm: "0.10.22-rc.20250304" };
const rows = (wasm: string) => manifest.map((row, i) => ({ ...row, session_id: `s-${i}`,
  predicted_gloss: row.expected_gloss, accepted: true, accepted_glosses: [row.expected_gloss],
  capture_mode: "unique-decoded-source-frames", status: "complete", errors: [] as string[],
  tasks_version: wasm, tasks_js_version: TASKS_VERSION, tasks_wasm_version: wasm,
  frames: 30, hand_frames: 15, analyses: 30, source_duration_s: 1.5,
  worker_sha256: "a".repeat(64), manifest_sha256: "b".repeat(64), vocabulary_sha256: "c".repeat(64),
  input_mirrored: false, preview_mirrored: true, model_mapping: "unchanged" }));
const verify = (a = rows(baseline.wasm), b = rows(TASKS_VERSION)) => verifyRuntimeChange(manifest, a, b, baseline);
describe("explicit runtime comparison retains recognition and evidence gates", () => {
  it("allows only the declared runtime change and reports tracking differences", () => {
    const candidate = rows(TASKS_VERSION); candidate[0].hand_frames = 16;
    expect(verify(rows(baseline.wasm), candidate)).toMatchObject({ paired_trials: 5, new_holdout: false, changes: [] });
    expect(() => verifyRuntimeChange(manifest, rows(baseline.wasm), candidate, {})).toThrow("Declare");
    const mislabeled = rows(TASKS_VERSION); mislabeled[0].tasks_wasm_version = "unknown";
    expect(() => verify(rows(baseline.wasm), mislabeled)).toThrow("Unexpected runtime");
  });
  it("rejects different workers, input frames, held-out rows and incomplete runs", () => {
    const worker = rows(TASKS_VERSION); worker[0].worker_sha256 = "d".repeat(64);
    expect(() => verify(rows(baseline.wasm), worker)).toThrow("worker_sha256");
    const frames = rows(TASKS_VERSION); frames[0].frames = 31;
    expect(() => verify(rows(baseline.wasm), frames)).toThrow("frames");
    const held = rows(TASKS_VERSION); held[0].evaluation_split = "held_out";
    expect(() => verify(rows(baseline.wasm), held)).toThrow(/held_out|Mismatched/);
    expect(() => verify(rows(baseline.wasm), rows(TASKS_VERSION).slice(1))).toThrow("Incomplete");
    const failed = rows(TASKS_VERSION); failed[0].status = "error";
    expect(() => verify(rows(baseline.wasm), failed)).toThrow("Failed");
  });
  it("rejects new wrong words and loss of an existing correct recognition", () => {
    const wrong = rows(TASKS_VERSION); wrong[0].accepted_glosses.push("PLEASE");
    expect(() => verify(rows(baseline.wasm), wrong)).toThrow("New wrong acceptance");
    const lost = rows(TASKS_VERSION); lost[0].accepted_glosses = []; lost[0].accepted = false;
    // A rejected trial must also clear its first-prediction field.
    const candidate = lost.map((row, i) => i ? row : { ...row, predicted_gloss: null });
    expect(() => verifyRuntimeChange(manifest, rows(baseline.wasm), candidate, baseline)).toThrow("Lost correct");
  });
  it("keeps frame stepping fixed during a runtime-only experiment", () => {
    const changed = rows(TASKS_VERSION).map(row => ({ ...row, frame_stepper: "seek-and-presentation-v1" }));
    expect(() => verifyRuntimeChange(manifest, rows(baseline.wasm), changed, baseline)).toThrow("frame_stepper");
  });
});
