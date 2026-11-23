export const ASL_V31_ASSET_PATH = "/models/asl-v31";
export const ASL_V31_SOURCE_COMMIT = "ea4e5432df811fcfb91db926b741d21b12222098";
/**
 * "top1" publishes the argmax: no confidence or prototype floor, so a live signer whose correct top-1
 * lands under the calibrated bar still sees the word (measured: HELLO 0.46, WATER 0.75, HIGH 0.99).
 * "demo" is the same idea with a 0.70/0.55/0.30 gate, "strict" and "balanced" are the calibrated
 * policies kept for the sprint evidence. Switch this constant to change all four.
 */
export const ASL_V31_POLICY = "top1";
export const ASL_V31_TRACKER_FILE = "asl-v3-tracker.worker.js";

// Exact assets from the frozen V3.1 model in PR #65.
export const ASL_V31_ASSET_PINS = {
  "model.onnx": { bytes: 13740990, sha256: "b3e05424f4674d8235ac8bc51970cef6822e12ac629c4a02bca596bc7f5d3090" },
  "meta.json": { bytes: 1077990, sha256: "50d59fdada18cc5c43ac61585f3af9c81d828402e2c2ba27c5ebeae86489ad22" },
  "policy-strict.json": { bytes: 535, sha256: "751fd950bde3ab3166653bb1dd4884a155fd831bb92bc4a7a16a6691c5fb48e0" },
  "policy-balanced.json": { bytes: 536, sha256: "feca858e67e0fa5bd89ee3be7ce80bd599a7c9ab0ac8d7f952c52648519e460a" },
  "policy-demo.json": { bytes: 970, sha256: "e47b25fea6e79d5ab7fd9654e8355c3f14250d1287855c7bbecf4ddeebb1e41f" },
  "policy-top1.json": { bytes: 910, sha256: "bfb1862dd571c0572e72628d8f9051619e7df10dcbad8a8014d7e4db9f58b15d" },
};
