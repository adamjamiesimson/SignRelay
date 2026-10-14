import * as ort from "onnxruntime-web";
import { downloadModelBytes } from "./model-download";

export type InferenceOptions = { signal?: AbortSignal; onPhase?: (phase: "loading" | "inference") => void };

function abortable<T>(task: Promise<T>, signal: AbortSignal, dispose?: (value: T) => void) {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new DOMException("Cancelled", "AbortError"));
    if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true });
    task.then(value => { if (signal.aborted) dispose?.(value); else resolve(value); }, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}

/** Cache a successful load, but allow the worker's backoff to retry failures. */
export function createLandmarkModelLoader(directory: string, classes: number) {
  type Loaded = { session: ort.InferenceSession; labels: string[] };
  let pending: { promise: Promise<Loaded>; controller: AbortController } | null = null;
  let ready: Loaded | null = null;

  return function loadModel(signal?: AbortSignal): Promise<Loaded> {
    signal?.throwIfAborted();
    if (ready) return Promise.resolve(ready);
    if (pending?.controller.signal.aborted) pending = null;
    if (!pending) {
      const controller = new AbortController();
      const attempt = { controller, promise: null! as Promise<Loaded> };
      pending = attempt;
      attempt.promise = (async () => {
        // Validate labels first so a failed label request cannot leak a session.
        const labelBytes = await downloadModelBytes(`${directory}/labels.json`, { signal: controller.signal, maxBytes: 1024 * 1024 });
        const labels: unknown = JSON.parse(new TextDecoder().decode(labelBytes));
        if (!Array.isArray(labels) || labels.length !== classes
          || labels.some(label => typeof label !== "string" || !label.trim())
          || new Set(labels).size !== classes) {
          throw new Error(`Expected ${classes} distinct, nonempty model labels`);
        }
        const bytes = await downloadModelBytes(`${directory}/model.onnx`, { signal: controller.signal });
        // ORT's URL loader cannot be cancelled. Own the download and bound the
        // remaining compilation separately; release any late-created session.
        const compilation = new AbortController();
        const abort = () => compilation.abort(controller.signal.reason);
        controller.signal.addEventListener("abort", abort, { once: true });
        const timer = setTimeout(() => compilation.abort(new Error("Model initialization timed out")), 90000);
        let session: ort.InferenceSession;
        try {
          session = await abortable(ort.InferenceSession.create(bytes, {
              executionProviders: ["webgpu", "wasm"],
          }), compilation.signal, value => { void value.release().catch(() => {}); });
        } finally { clearTimeout(timer); controller.signal.removeEventListener("abort", abort); }
        if (controller.signal.aborted) { await session.release(); controller.signal.throwIfAborted(); }
        ready = { session, labels: labels as string[] };
        return ready;
    })().catch(error => {
      if (pending === attempt) pending = null;
      throw error;
    });
    }
    const attempt = pending;
    const abort = () => attempt.controller.abort(signal?.reason);
    signal?.addEventListener("abort", abort, { once: true });
    // Catch/finally without retaining a rejected orphan promise.
    return attempt.promise.finally(() => signal?.removeEventListener("abort", abort));
  };
}
