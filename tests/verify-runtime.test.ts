import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { FULL_MODEL_FILES, NON_ASL_WORKERS, verifyRuntime } from "../scripts/verify-runtime.mjs";

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
  const pins = `${sha("asl-model")}  model.json\n${sha("[]")}  labels.json\n`;
  writeFileSync(join(root, "models/asl2000-tgcn/sha256.txt"), pins);
  writeFileSync(join(root, "models/asl2000-tgcn/labels.json"), "[]");
  writeFileSync(join(root, "workers/recognition.worker.js"), "worker-v1");
  writeFileSync(join(root, "workers/template-matching.worker.js"), "template-worker-v1");
  edit(root);
  return { root, wasmSource: wasm, ortSource: ort, wasmFiles: ["a.wasm"], committedWorker: sha("worker-v1"),
    expectedAslPins: sha(pins), expectedTemplateWorker: sha("template-worker-v1"),
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
    ["a rewritten ASL checksum list", (root: string) => writeFileSync(join(root, "models/asl2000-tgcn/sha256.txt"), `${sha("asl-model")}  model.json\n`), "differs from the source checksum list"],
    ["missing ASL labels", (root: string) => rmSync(join(root, "models/asl2000-tgcn/labels.json")), "missing models/asl2000-tgcn/labels.json"],
    ["a missing ONNX Runtime file", (root: string) => rmSync(join(root, "workers/ort-wasm-simd-threaded.jsep.wasm")), "missing workers/ort-wasm"],
    ["an uncommitted worker build", (root: string) => writeFileSync(join(root, "workers/recognition.worker.js"), "worker-v2"), "differs from the committed bundle"],
    ["a missing personal-template worker", (root: string) => rmSync(join(root, "workers/template-matching.worker.js")), "missing workers/template-matching.worker.js"],
    ["a stale personal-template worker", (root: string) => writeFileSync(join(root, "workers/template-matching.worker.js"), "template-worker-v0"), "differs from the built bundle"],
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
    const withRslWorker = fixture(root => writeFileSync(join(root, "workers/rsl.worker.js"), "worker"));
    expect(verifyRuntime({ ...withRslWorker, profile: "asl-demo" }).failures).toContainEqual(expect.stringContaining("asl-demo export contains workers/rsl.worker.js"));
  });
  it("checks all installed full-profile models and clip workers against their source assets", () => {
    const setup = fixture();
    const sourceRoot = join(dirname(setup.root), "public");
    const paths = Object.entries(FULL_MODEL_FILES).flatMap(([dir, files]) => files.map(file => `models/${dir}/${file}`));
    for (const base of [setup.root, sourceRoot]) {
      for (const path of [...paths, ...NON_ASL_WORKERS.map(file => `workers/${file}`)]) {
        const target = join(base, path);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, path);
      }
    }
    expect(verifyRuntime({ ...setup, sourceRoot }).ok).toBe(true);
    writeFileSync(join(setup.root, "models/bsl1064-pose2sign/labels.json"), "changed");
    rmSync(join(setup.root, "models/rsl1000-slovo/model.onnx"));
    const result = verifyRuntime({ ...setup, sourceRoot });
    expect(result.failures.join("\n")).toContain("models/bsl1064-pose2sign/labels.json differs from the source");
    expect(result.failures.join("\n")).toContain("missing models/rsl1000-slovo/model.onnx");
  });
  it("allows the automated rehearsal hook only in the rehearsal profile", () => {
    const hooked = () => fixture(root => { mkdirSync(join(root, "_next/static/chunks"), { recursive: true }); writeFileSync(join(root, "_next/static/chunks/app.js"), "window.__signrelayRehearsal={}"); });
    expect(verifyRuntime({ ...hooked(), profile: "asl-demo" }).failures.join("\n")).toContain("contains the automated rehearsal hook");
    expect(verifyRuntime({ ...hooked(), profile: "full" }).failures.join("\n")).toContain("contains the automated rehearsal hook");
    expect(verifyRuntime({ ...hooked(), profile: "rehearsal" }).ok).toBe(true);
    const plain = fixture(root => { mkdirSync(join(root, "_next/static/chunks"), { recursive: true }); writeFileSync(join(root, "_next/static/chunks/app.js"), "console.log(1)"); });
    expect(verifyRuntime({ ...plain, profile: "rehearsal" }).failures.join("\n")).toContain("missing its rehearsal hook");
  });
});
