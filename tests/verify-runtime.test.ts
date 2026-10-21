import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { verifyRuntime } from "../scripts/verify-runtime.mjs";

// Synthetic stand-in files only: small byte strings, not real models.
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
function fixture(edit: (root: string) => void = () => {}) {
  const base = mkdtempSync(join(tmpdir(), "signrelay-runtime-"));
  const root = join(base, "out"), wasm = join(base, "wasm-src"), ort = join(base, "ort-src");
  for (const dir of [join(root, "vision/wasm"), join(root, "vision/models"), join(root, "models/asl2000-tgcn"), join(root, "workers"), wasm, ort]) mkdirSync(dir, { recursive: true });
  for (const [dir, name] of [[wasm, "a.wasm"], [join(root, "vision/wasm"), "a.wasm"]]) writeFileSync(join(dir, name), "wasm-bytes");
  writeFileSync(join(root, "vision/models/hand.task"), "model-bytes");
  for (const dir of [ort, join(root, "workers")]) for (const file of ["ort-wasm-simd-threaded.jsep.wasm", "ort-wasm-simd-threaded.jsep.mjs"]) writeFileSync(join(dir, file), file);
  writeFileSync(join(root, "models/asl2000-tgcn/model.json"), "asl-model");
  writeFileSync(join(root, "models/asl2000-tgcn/sha256.txt"), `${sha("asl-model")}  model.json\n`);
  writeFileSync(join(root, "models/asl2000-tgcn/labels.json"), "[]");
  writeFileSync(join(root, "workers/recognition.worker.js"), "worker-v1");
  edit(root);
  return { root, wasmSource: wasm, ortSource: ort, wasmFiles: ["a.wasm"], committedWorker: sha("worker-v1"),
    models: { hand: { file: "hand.task", bytes: 11, sha256: sha("model-bytes") } },
    evaluated: [{ worker_sha256: sha("worker-v1"), outcome: { correct: 5 }, evidence: ["x"] }] };
}

describe("deterministic runtime verifier", () => {
  it("accepts an intact runtime and identifies its evaluated worker", () => {
    const result = verifyRuntime(fixture());
    expect(result.failures).toEqual([]);
    expect(result.manifest).toMatchObject({ matches_committed_worker: true, real_video_evidence: { outcome: { correct: 5 } } });
  });
  it.each([
    ["a tampered pinned model", (root: string) => writeFileSync(join(root, "vision/models/hand.task"), "model-bytez"), "does not match its pinned size and SHA-256"],
    ["a missing model", (root: string) => rmSync(join(root, "vision/models/hand.task")), "missing vision/models/hand.task"],
    ["a stale WASM copy", (root: string) => writeFileSync(join(root, "vision/wasm/a.wasm"), "old-wasm"), "differs from @mediapipe/tasks-vision"],
    ["a modified ASL model", (root: string) => writeFileSync(join(root, "models/asl2000-tgcn/model.json"), "patched"), "does not match sha256.txt"],
    ["a missing ONNX Runtime file", (root: string) => rmSync(join(root, "workers/ort-wasm-simd-threaded.jsep.wasm")), "missing workers/ort-wasm"],
    ["an uncommitted worker build", (root: string) => writeFileSync(join(root, "workers/recognition.worker.js"), "worker-v2"), "differs from the committed bundle"],
  ])("fails with an actionable message for %s", (_name, edit, message) => {
    const result = verifyRuntime(fixture(edit));
    expect(result.ok).toBe(false);
    expect(result.failures.join("\n")).toContain(message);
    expect(result.failures.every((failure: string) => failure.includes(" — "))).toBe(true);
  });
  it("reports a worker without real-video evidence instead of borrowing older results", () => {
    const setup = fixture();
    const result = verifyRuntime({ ...setup, evaluated: [] });
    expect(result.manifest.real_video_evidence).toBeNull();
  });
  it("rejects other language models in the ASL demo profile but allows their licence notices", () => {
    const withRsl = (files: string[]) => fixture(root => {
      mkdirSync(join(root, "models/rsl1000-slovo"));
      for (const file of files) writeFileSync(join(root, "models/rsl1000-slovo", file), "x");
    });
    const result = verifyRuntime({ ...withRsl(["ATTRIBUTION.md", "labels.json"]), profile: "asl-demo" });
    expect(result.failures.join("\n")).toContain("asl-demo export contains models/rsl1000-slovo/labels.json");
    expect(verifyRuntime({ ...withRsl(["ATTRIBUTION.md", "LICENSE.pdf"]), profile: "asl-demo" }).ok).toBe(true);
  });
});
