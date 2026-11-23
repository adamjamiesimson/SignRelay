// Establishes exactly which recognition runtime an export (or public/) holds:
// MediaPipe WASM + pinned models, ASL checkpoints, ONNX Runtime WASM and the
// recognition worker bundles. Any missing, stale or tampered file fails with an
// actionable message. Writes runtime-manifest.json next to the export.
//
//   node scripts/verify-runtime.mjs [--out out] [--profile full|asl-demo] [--require-evaluated]
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { ASL_V31_ASSET_PATH, ASL_V31_ASSET_PINS, ASL_V31_POLICY, ASL_V31_SOURCE_COMMIT, ASL_V31_TRACKER_FILE } from "../lib/asl-v31-assets.mjs";
import { TASKS_VERSION, VISION_MODELS, VISION_WASM_FILES } from "../lib/vision-runtime.mjs";

const require = createRequire(import.meta.url);
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const fileSha = path => existsSync(path) ? sha(readFileSync(path)) : null;

export const FULL_MODEL_FILES = {
  "bdsl401-videomae": ["model.onnx", "labels.json", "manifest.json"],
  "bsl1064-pose2sign": ["model.onnx", "labels.json", "model.json"],
  "isl263-include": ["model.onnx", "labels.json", "model.json"],
  "lse300-swl": ["model.onnx", "labels.json", "model.json"],
  "psl776-hfad": ["templates.json.gz", "labels.json"],
  "rsl1000-slovo": ["model.onnx", "labels.json", "manifest.json"],
};
/** Language model directories that the ASL demo profile must not ship. */
export const NON_ASL_MODEL_DIRS = Object.keys(FULL_MODEL_FILES);
export const NON_ASL_WORKERS = ["rsl.worker.js", "bdsl.worker.js"];
export const REHEARSAL_HOOK = "__signrelayRehearsal";
const jsFiles = dir => !existsSync(dir) ? [] : readdirSync(dir).flatMap(name => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? jsFiles(path) : name.endsWith(".js") ? [path] : [];
});
/** Licence and attribution documents stay in the ASL demo so linked notices keep working; no weights, labels or templates. */
export const KEPT_NOTICES = new Set(["ATTRIBUTION.md", "LICENSE.pdf"]);

/** @param {{ root: string, wasmSource: string, ortSource: string, expectedAslPins?: string | null,
 *   expectedTemplateWorker?: string | null, committedWorker?: string | null, evaluated?: any[], sourceRoot?: string,
 *   v31Pins?: Record<string, { bytes: number, sha256: string }>,
 *   profile?: string, wasmFiles?: string[], models?: Record<string, { file: string, bytes: number, sha256: string }> }} options */
export function verifyRuntime({ root, wasmSource, ortSource, expectedAslPins, expectedTemplateWorker,
  committedWorker = null, evaluated = [], sourceRoot, profile = "full",
  wasmFiles = VISION_WASM_FILES, models = VISION_MODELS, v31Pins = ASL_V31_ASSET_PINS }) {
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
    if (profile === "rehearsal" && model.file === VISION_MODELS.hand.file) continue;
    const path = join(root, "vision/models", model.file);
    const digest = record(`vision/models/${model.file}`, path);
    if (!digest) fail(`missing vision/models/${model.file}`, "run npm run install:vision-assets on a connected machine");
    else if (digest !== model.sha256 || readFileSync(path).length !== model.bytes) fail(`vision/models/${model.file} does not match its pinned size and SHA-256`, "delete it and rerun npm run install:vision-assets");
  }
  const v31Directory = ASL_V31_ASSET_PATH.slice(1);
  const tracker = `workers/${ASL_V31_TRACKER_FILE}`;
  if (profile === "rehearsal") {
    manifest.asl_engine = { version: "engine-1" };
    for (const path of [tracker, `vision/models/${VISION_MODELS.hand.file}`, ...Object.keys(v31Pins).map(file => `${v31Directory}/${file}`)]) {
      if (existsSync(join(root, path))) fail(`rehearsal export contains ${path}`, "rebuild with npm run build:rehearsal");
    }
  } else {
    for (const [file, pin] of Object.entries(v31Pins)) {
      const asset = `${v31Directory}/${file}`;
      const path = join(root, asset);
      const digest = record(asset, path);
      if (!digest) fail(`missing ${asset}`, "restore the committed Engine V3.1 assets and rebuild");
      else if (digest !== pin.sha256 || statSync(path).size !== pin.bytes)
        fail(`${asset} differs from its pinned size or SHA-256`, "restore the committed Engine V3.1 assets and rebuild");
    }
    const digest = record(tracker, join(root, tracker));
    if (!digest) fail(`missing ${tracker}`, "run npm run build:worker and rebuild the export");
    else if (sourceRoot && root !== sourceRoot && digest !== fileSha(join(sourceRoot, tracker)))
      fail(`${tracker} differs from the built bundle`, "run npm run build:worker and rebuild the export");
    manifest.asl_engine = { version: "engine-v3.1", source_commit: ASL_V31_SOURCE_COMMIT, policy: ASL_V31_POLICY,
      model_sha256: manifest.files[`${v31Directory}/model.onnx`], tracker_worker_sha256: digest };
  }
  const asl = join(root, "models/asl2000-tgcn");
  const pinsPath = join(asl, "sha256.txt");
  const pinsSha = record("models/asl2000-tgcn/sha256.txt", pinsPath);
  const names = new Set();
  if (!pinsSha) fail("models/asl2000-tgcn/sha256.txt is missing", "the ASL model checksum list must ship with the model");
  else if (expectedAslPins !== undefined && pinsSha !== expectedAslPins) {
    fail("models/asl2000-tgcn/sha256.txt differs from the source checksum list", "restore the committed ASL model files and rebuild");
  } else for (const line of readFileSync(pinsPath, "utf8").trim().split("\n")) {
    const entry = /^([a-f0-9]{64})\s+([a-zA-Z0-9][a-zA-Z0-9._-]*)$/.exec(line.trim());
    if (!entry || names.has(entry[2])) {
      fail("models/asl2000-tgcn/sha256.txt has invalid or duplicate entries", "restore the committed ASL model checksum list");
      break;
    }
    const [, digest, name] = entry;
    names.add(name);
    const actual = record(`models/asl2000-tgcn/${name}`, join(asl, name));
    if (!actual) fail(`missing models/asl2000-tgcn/${name}`, "restore the committed ASL-2000 model files");
    else if (actual !== digest) fail(`models/asl2000-tgcn/${name} does not match sha256.txt`, "the ASL model was modified; restore it from Git");
  }
  if (pinsSha && (!names.has("model.json") || !names.has("labels.json")))
    fail("models/asl2000-tgcn/sha256.txt does not pin the model and labels", "restore the committed ASL model checksum list");
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
  const templateWorker = record("workers/template-matching.worker.js", join(root, "workers/template-matching.worker.js"));
  if (!templateWorker) fail("missing workers/template-matching.worker.js", "run npm run build:worker and rebuild the export");
  else if (expectedTemplateWorker !== undefined && templateWorker !== expectedTemplateWorker)
    fail("workers/template-matching.worker.js differs from the built bundle", "run npm run build:worker and rebuild the export");
  const evidence = evaluated.find(entry => entry.worker_sha256 === worker);
  manifest.real_video_evidence = evidence ? { outcome: evidence.outcome, evidence: evidence.evidence } : null;
  if (profile === "full" && sourceRoot) {
    const modelPaths = Object.entries(FULL_MODEL_FILES).flatMap(([dir, files]) => files.map(file => `models/${dir}/${file}`));
    for (const path of [...modelPaths, ...NON_ASL_WORKERS.map(file => `workers/${file}`)]) {
      const actual = record(path, join(root, path));
      if (!actual) fail(`missing ${path}`, "rebuild with npm run build:firebase");
      else if (root !== sourceRoot && actual !== fileSha(join(sourceRoot, path)))
        fail(`${path} differs from the source or built asset`, "restore the verified source asset and rebuild with npm run build:firebase");
    }
  }
  // The rehearsal hook must exist only in the rehearsal build.
  const scripts = jsFiles(join(root, "_next"));
  const hooked = scripts.filter(file => readFileSync(file, "utf8").includes(REHEARSAL_HOOK));
  manifest.rehearsal_hook = hooked.length > 0;
  if (profile !== "rehearsal" && hooked.length) fail(`${profile} export contains the automated rehearsal hook`, "rebuild without NEXT_PUBLIC_SIGNRELAY_PROFILE=rehearsal");
  if (profile === "rehearsal" && scripts.length && !hooked.length) fail("rehearsal export is missing its rehearsal hook", "rebuild with npm run build:rehearsal");
  if (profile === "asl-demo" || profile === "rehearsal") {
    for (const dir of NON_ASL_MODEL_DIRS) {
      const shipped = existsSync(join(root, "models", dir)) ? readdirSync(join(root, "models", dir)).filter(name => !KEPT_NOTICES.has(name)) : [];
      if (shipped.length) fail(`asl-demo export contains models/${dir}/${shipped.join(", ")}`, "the ASL profile must not ship other language models; rebuild with npm run build:asl-demo");
    }
    for (const file of NON_ASL_WORKERS) if (existsSync(join(root, "workers", file)))
      fail(`asl-demo export contains workers/${file}`, "the ASL profile must not ship other languages' clip workers; rebuild with npm run build:asl-demo");
  }
  return { ok: failures.length === 0, failures, manifest };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const option = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
  const root = option("--out", "out");
  const manifestPath = join(root, "runtime-manifest.json");
  const existingManifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : {};
  const committed = spawnSync("git", ["show", "HEAD:public/workers/recognition.worker.js"], { encoding: "buffer", maxBuffer: 64 * 1024 * 1024 });
  const committedAslPins = spawnSync("git", ["show", "HEAD:public/models/asl2000-tgcn/sha256.txt"], { encoding: "buffer" });
  const result = verifyRuntime({ root, profile: option("--profile", existsSync(join(root, "models/bdsl401-videomae/model.onnx")) ? "full" : "asl-demo"),
    wasmSource: join(dirname(require.resolve("@mediapipe/tasks-vision")), "wasm"), ortSource: dirname(require.resolve("onnxruntime-web")),
    expectedAslPins: committedAslPins.status === 0 ? sha(committedAslPins.stdout) : fileSha("public/models/asl2000-tgcn/sha256.txt"),
    expectedTemplateWorker: fileSha("public/workers/template-matching.worker.js"),
    sourceRoot: "public",
    committedWorker: committed.status === 0 ? sha(committed.stdout) : null,
    evaluated: JSON.parse(readFileSync("docs/evaluation/evaluated-runtimes.json", "utf8")).runtimes });
  if (args.includes("--require-evaluated") && !result.manifest.real_video_evidence)
    result.failures.push("this recognition worker has no recorded real-video development evidence — run the paired video pilot and record it in docs/evaluation/evaluated-runtimes.json");
  // Rechecking an existing export must not relabel it as the current checkout.
  let { application_revision, application_source_dirty } = existingManifest;
  if (args.includes("--record-revision")) {
    const revision = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" });
    const status = spawnSync("git", ["status", "--porcelain"], { encoding: "utf8" });
    application_revision = revision.status === 0 ? revision.stdout.trim() : null;
    application_source_dirty = status.status === 0 ? status.stdout.trim() !== "" : null;
  }
  Object.assign(result.manifest, { application_revision: application_revision ?? null, application_source_dirty: application_source_dirty ?? null });
  // Only successful exports get a manifest. public/ is source and must stay unchanged.
  if (!result.failures.length && existsSync(root) && root.replace(/\/$/, "") !== "public")
    writeFileSync(manifestPath, JSON.stringify(result.manifest, null, 2) + "\n");
  console.log(JSON.stringify({ ok: result.failures.length === 0, failures: result.failures, recognition_worker_sha256: result.manifest.recognition_worker_sha256,
    matches_committed_worker: result.manifest.matches_committed_worker, asl_engine: result.manifest.asl_engine, application_revision: result.manifest.application_revision,
    real_video_evidence: result.manifest.real_video_evidence?.outcome ?? "none recorded" }, null, 2));
  if (result.failures.length) process.exit(1);
}
