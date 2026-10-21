// Establishes exactly which recognition runtime an export (or public/) holds:
// MediaPipe WASM + pinned models, the ASL-2000 model, ONNX Runtime WASM and the
// recognition worker bundle. Any missing, stale or tampered file fails with an
// actionable message. Writes runtime-manifest.json next to the export.
//
//   node scripts/verify-runtime.mjs [--out out] [--profile full|asl-demo] [--require-evaluated]
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { TASKS_VERSION, VISION_MODELS, VISION_WASM_FILES } from "../lib/vision-runtime.mjs";

const require = createRequire(import.meta.url);
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const fileSha = path => existsSync(path) ? sha(readFileSync(path)) : null;

/** Language model directories that the ASL demo profile must not ship. */
export const NON_ASL_MODEL_DIRS = ["bdsl401-videomae", "bsl1064-pose2sign", "isl263-include", "lse300-swl", "psl776-hfad", "rsl1000-slovo"];
export const REHEARSAL_HOOK = "__signrelayRehearsal";
const jsFiles = dir => !existsSync(dir) ? [] : readdirSync(dir).flatMap(name => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? jsFiles(path) : name.endsWith(".js") ? [path] : [];
});
/** Licence and attribution documents stay in the ASL demo so linked notices keep working; no weights, labels or templates. */
export const KEPT_NOTICES = new Set(["ATTRIBUTION.md", "LICENSE.pdf"]);

/** @param {{ root: string, wasmSource: string, ortSource: string, committedWorker?: string | null, evaluated?: any[],
 *   profile?: string, wasmFiles?: string[], models?: Record<string, { file: string, bytes: number, sha256: string }> }} options */
export function verifyRuntime({ root, wasmSource, ortSource, committedWorker = null, evaluated = [], profile = "full",
  wasmFiles = VISION_WASM_FILES, models = VISION_MODELS }) {
  const failures = [];
  const fail = (what, fix) => failures.push(`${what} — ${fix}`);
  /** @type {Record<string, any>} */
  const manifest = { schema: 1, profile, tasks_version: TASKS_VERSION, files: {} };
  const record = (key, path) => { const digest = fileSha(path); manifest.files[key] = digest; return digest; };

  for (const file of wasmFiles) {
    const digest = record(`vision/wasm/${file}`, join(root, "vision/wasm", file));
    const expected = fileSha(join(wasmSource, file));
    if (!digest) fail(`missing vision/wasm/${file}`, "run npm run build:worker (copies the locked @mediapipe/tasks-vision WASM)");
    else if (digest !== expected) fail(`vision/wasm/${file} differs from @mediapipe/tasks-vision@${TASKS_VERSION}`, "stale or tampered copy; run npm ci && npm run build:worker");
  }
  for (const model of Object.values(models)) {
    const path = join(root, "vision/models", model.file);
    const digest = record(`vision/models/${model.file}`, path);
    if (!digest) fail(`missing vision/models/${model.file}`, "run npm run install:vision-assets on a connected machine");
    else if (digest !== model.sha256 || readFileSync(path).length !== model.bytes) fail(`vision/models/${model.file} does not match its pinned size and SHA-256`, "delete it and rerun npm run install:vision-assets");
  }
  const asl = join(root, "models/asl2000-tgcn");
  const pins = existsSync(join(asl, "sha256.txt")) ? readFileSync(join(asl, "sha256.txt"), "utf8").trim().split("\n").map(line => line.trim().split(/\s+/)) : [];
  if (!pins.length) fail("models/asl2000-tgcn/sha256.txt is missing", "the ASL model checksum list must ship with the model");
  for (const [digest, name] of pins) {
    const actual = record(`models/asl2000-tgcn/${name}`, join(asl, name));
    if (!actual) fail(`missing models/asl2000-tgcn/${name}`, "restore the committed ASL-2000 model files");
    else if (actual !== digest) fail(`models/asl2000-tgcn/${name} does not match sha256.txt`, "the ASL model was modified; restore it from Git");
  }
  record("models/asl2000-tgcn/labels.json", join(asl, "labels.json"));
  for (const file of ["ort-wasm-simd-threaded.jsep.wasm", "ort-wasm-simd-threaded.jsep.mjs"]) {
    const digest = record(`workers/${file}`, join(root, "workers", file));
    if (!digest) fail(`missing workers/${file}`, "run npm run build:worker (copies the locked onnxruntime-web files)");
    else if (digest !== fileSha(join(ortSource, file))) fail(`workers/${file} differs from the installed onnxruntime-web`, "run npm ci && npm run build:worker");
  }
  const worker = record("workers/recognition.worker.js", join(root, "workers/recognition.worker.js"));
  if (!worker) fail("missing workers/recognition.worker.js", "run npm run build:worker");
  manifest.recognition_worker_sha256 = worker;
  manifest.matches_committed_worker = committedWorker ? worker === committedWorker : null;
  if (worker && committedWorker && worker !== committedWorker)
    fail("workers/recognition.worker.js differs from the committed bundle", "rebuild with npm ci && npm run build:worker and commit the bundle with the recognition change, or this export is not the evaluated code");
  const evidence = evaluated.find(entry => entry.worker_sha256 === worker);
  manifest.real_video_evidence = evidence ? { outcome: evidence.outcome, evidence: evidence.evidence } : null;
  // The rehearsal hook must exist only in the rehearsal build.
  const scripts = jsFiles(join(root, "_next"));
  const hooked = scripts.filter(file => readFileSync(file, "utf8").includes(REHEARSAL_HOOK));
  manifest.rehearsal_hook = hooked.length > 0;
  if (profile !== "rehearsal" && hooked.length) fail(`${profile} export contains the automated rehearsal hook`, "rebuild without NEXT_PUBLIC_SIGNRELAY_PROFILE=rehearsal");
  if (profile === "rehearsal" && scripts.length && !hooked.length) fail("rehearsal export is missing its rehearsal hook", "rebuild with npm run build:rehearsal");
  if (profile === "asl-demo" || profile === "rehearsal") for (const dir of NON_ASL_MODEL_DIRS) {
    const shipped = existsSync(join(root, "models", dir)) ? readdirSync(join(root, "models", dir)).filter(name => !KEPT_NOTICES.has(name)) : [];
    if (shipped.length) fail(`asl-demo export contains models/${dir}/${shipped.join(", ")}`, "the ASL profile must not ship other language models; rebuild with npm run build:asl-demo");
  }
  return { ok: failures.length === 0, failures, manifest };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const option = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
  const root = option("--out", "out");
  const committed = spawnSync("git", ["show", "HEAD:public/workers/recognition.worker.js"], { encoding: "buffer", maxBuffer: 64 * 1024 * 1024 });
  const result = verifyRuntime({ root, profile: option("--profile", existsSync(join(root, "models/bdsl401-videomae/model.onnx")) ? "full" : "asl-demo"),
    wasmSource: join(dirname(require.resolve("@mediapipe/tasks-vision")), "wasm"), ortSource: dirname(require.resolve("onnxruntime-web")),
    committedWorker: committed.status === 0 ? sha(committed.stdout) : null,
    evaluated: JSON.parse(readFileSync("docs/evaluation/evaluated-runtimes.json", "utf8")).runtimes });
  if (args.includes("--require-evaluated") && !result.manifest.real_video_evidence)
    result.failures.push("this recognition worker has no recorded real-video development evidence — run the paired video pilot and record it in docs/evaluation/evaluated-runtimes.json");
  // Only exports get a manifest; public/ is source and must stay unchanged.
  if (existsSync(root) && root.replace(/\/$/, "") !== "public") writeFileSync(join(root, "runtime-manifest.json"), JSON.stringify(result.manifest, null, 2) + "\n");
  console.log(JSON.stringify({ ok: result.failures.length === 0, failures: result.failures, recognition_worker_sha256: result.manifest.recognition_worker_sha256,
    matches_committed_worker: result.manifest.matches_committed_worker, real_video_evidence: result.manifest.real_video_evidence?.outcome ?? "none recorded" }, null, 2));
  if (result.failures.length) process.exit(1);
}
