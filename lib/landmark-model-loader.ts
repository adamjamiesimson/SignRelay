import * as ort from "onnxruntime-web";

// Firebase Hosting is not cross-origin isolated. Use the same single-threaded,
// locally hosted WASM runtime as the clip recognizers, including in workers.
ort.env.wasm.numThreads = 1;
ort.env.wasm.wasmPaths = "/workers/";

/** Cache a successful load, but allow the worker's backoff to retry failures. */
export function createLandmarkModelLoader(directory: string, classes: number) {
  let pending: Promise<{ session: ort.InferenceSession; labels: string[] }> | null = null;

  return function loadModel() {
    pending ??= (async () => {
      // Validate labels first so a failed label request cannot leak a session.
      const response = await fetch(`${directory}/labels.json`);
      if (!response.ok) throw new Error(`Model labels could not load (${response.status})`);
      const labels: unknown = await response.json();
      if (!Array.isArray(labels) || labels.length !== classes
        || labels.some(label => typeof label !== "string" || !label.trim())
        || new Set(labels).size !== classes) {
        throw new Error(`Expected ${classes} distinct, nonempty model labels`);
      }
      const session = await ort.InferenceSession.create(`${directory}/model.onnx`, {
        executionProviders: ["wasm"],
      });
      return { session, labels: labels as string[] };
    })().catch(error => {
      pending = null;
      throw error;
    });
    return pending;
  };
}
