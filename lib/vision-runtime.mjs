// Keep the JS package, WASM/glue, CSP and diagnostic metadata on one exact
// release. scripts/verify-vision-runtime.mjs checks the installed lockfile.
export const TASKS_VERSION = "0.10.35";
export const TASKS_WASM_PATH = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VERSION}/wasm`;

// Self-hosted copies (scripts/install-vision-assets.mjs) keep the demo working
// when CDNs are unreachable. WASM comes from the locked npm package; models
// (Apache-2.0) are pinned by size and SHA-256 and match the CDN fallback bytes.
export const LOCAL_WASM_PATH = "/vision/wasm";
export const LOCAL_MODEL_PATH = "/vision/models";
export const VISION_WASM_FILES = ["vision_wasm_internal.js", "vision_wasm_internal.wasm",
  "vision_wasm_nosimd_internal.js", "vision_wasm_nosimd_internal.wasm"];
export const VISION_MODELS = {
  gesture: { file: "gesture_recognizer.task", bytes: 8373440, sha256: "97952348cf6a6a4915c2ea1496b4b37ebabc50cbbf80571435643c455f2b0482",
    url: "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task" },
  face: { file: "face_landmarker.task", bytes: 3758596, sha256: "64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff",
    url: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task" },
  pose: { file: "pose_landmarker_lite.task", bytes: 5777746, sha256: "59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a",
    url: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task" },
};
const paths = base => Object.fromEntries(Object.entries(VISION_MODELS).map(([key, model]) => [key, base ? `${base}/${model.file}` : model.url]));
/** Tried in order: self-hosted, then the public CDN. */
export const VISION_ASSET_SOURCES = [
  { id: "self-hosted", wasm: LOCAL_WASM_PATH, models: paths(LOCAL_MODEL_PATH) },
  { id: "cdn", wasm: TASKS_WASM_PATH, models: paths(null) },
];
