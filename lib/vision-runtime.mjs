// Keep the JS package, WASM/glue, CSP and diagnostic metadata on one exact
// release. scripts/verify-vision-runtime.mjs checks the installed lockfile.
export const TASKS_VERSION = "0.10.35";
export const TASKS_WASM_PATH = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VERSION}/wasm`;
