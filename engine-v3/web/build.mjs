// Build the static V3 lab into engine-v3/web/dist.
//   node engine-v3/web/build.mjs <model-dir>   (model-dir holds model.onnx + meta.json)
// Task bundles are taken from SIGNRELAY_MODELS or downloaded from Google's official mirror,
// and every asset is pinned by SHA-256 in meta.json (checked again in the browser).
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const out = process.env.V3_OUT ?? join(here, "dist");
const modelDir = process.argv[2] ?? join(here, "..", "models", "current");
const sha = b => createHash("sha256").update(b).digest("hex");
const TASKS = {
  "hand_landmarker.task": ["https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task", "fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1"],
  "pose_landmarker_lite.task": ["https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task", "59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a"],
  "face_landmarker.task": ["https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task", "64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff"],
};

await rm(out, { recursive: true, force: true });
for (const d of ["vision/wasm", "vision/models", "ort"]) await mkdir(join(out, d), { recursive: true });
const assets = {};
const metaPeek = JSON.parse(await readFile(join(modelDir, "meta.json"), "utf8"));
for (const [f, [url, digest]] of Object.entries(TASKS)) {
  if (f === "face_landmarker.task" && metaPeek.uses_face === false) continue;
  const local = join(process.env.SIGNRELAY_MODELS ?? "/home/user/data/models", f);
  const bytes = existsSync(local) ? await readFile(local) : Buffer.from(await (await fetch(url)).arrayBuffer());
  if (sha(bytes) !== digest) throw new Error(`${f}: SHA-256 mismatch`);
  await writeFile(join(out, "vision/models", f), bytes); assets[f] = digest;
}
const tv = join(root, "node_modules/@mediapipe/tasks-vision/wasm");
for (const f of ["vision_wasm_internal.js", "vision_wasm_internal.wasm", "vision_wasm_nosimd_internal.js", "vision_wasm_nosimd_internal.wasm"])
  await copyFile(join(tv, f), join(out, "vision/wasm", f));
const ortDist = join(root, "node_modules/onnxruntime-web/dist");
for (const f of ["ort-wasm-simd-threaded.mjs", "ort-wasm-simd-threaded.wasm"]) await copyFile(join(ortDist, f), join(out, "ort", f));

const model = await readFile(join(modelDir, "model.onnx"));
const meta = JSON.parse(await readFile(join(modelDir, "meta.json"), "utf8"));
if (sha(model) !== meta.model_sha256) throw new Error("model.onnx does not match meta.json fingerprint");
let commit = process.env.VERCEL_GIT_COMMIT_SHA;
try { commit ??= execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(); } catch { commit ??= "unknown"; }
meta.commit = commit; meta.assets = assets;
// Both decision presets (balanced = default, strict) travel with the model; balanced must equal meta.policy.
meta.policies = { balanced: meta.policy };
for (const name of ["balanced", "strict"]) {
  const f = join(modelDir, `policy-${name}.json`);
  if (!existsSync(f)) continue;
  const p = JSON.parse(await readFile(f, "utf8"));
  if (name === "balanced" && ["temperature", "max_unknown", "min_top1", "min_proto"].some(k => p[k] !== meta.policy[k]))
    throw new Error("policy-balanced.json does not match meta.json policy");
  meta.policies[name] = name === "balanced" ? meta.policy : p;
}
await writeFile(join(out, "model.onnx"), model);
await writeFile(join(out, "meta.json"), JSON.stringify(meta));
await build({ entryPoints: { app: join(here, "app.mjs") }, bundle: true, format: "esm",
  platform: "browser", target: "es2022", outdir: out, minify: true, legalComments: "eof", logLevel: "warning" });
// classic worker: MediaPipe's WASM loader uses importScripts, which module workers lack
await build({ entryPoints: { worker: join(here, "worker.mjs") }, bundle: true, format: "iife",
  platform: "browser", target: "es2022", outdir: out, minify: true, legalComments: "eof", logLevel: "warning" });
for (const f of ["index.html", "style.css"]) await copyFile(join(here, f), join(out, f));
await writeFile(join(out, "vercel.json"), JSON.stringify({ headers: [{ source: "/(.*)", headers: [
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" }, { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
  { key: "Permissions-Policy", value: "camera=(self)" }, { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; media-src 'self' blob:; img-src 'self' blob: data:; style-src 'self'; connect-src 'self'; frame-ancestors 'none'" },
] }] }, null, 1));
console.log("built", out, "model", meta.model_sha256.slice(0, 12), "classes", meta.classes.length, "policies", Object.keys(meta.policies).join("+"));
