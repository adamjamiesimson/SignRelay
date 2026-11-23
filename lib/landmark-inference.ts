import type * as ort from "onnxruntime-web";
import type { InferenceOptions } from "./landmark-model-loader";

type Lane = { waiters: Set<() => void> };
const running = new WeakMap<ort.InferenceSession, Lane>();

function waitForRun(lane: Lane, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => { lane.waiters.delete(done); signal?.removeEventListener("abort", abort); };
    const done = () => { cleanup(); resolve(); };
    const abort = () => { cleanup(); reject(signal?.reason ?? new DOMException("Cancelled", "AbortError")); };
    lane.waiters.add(done);
    if (signal?.aborted) abort(); else signal?.addEventListener("abort", abort, { once: true });
  });
}

/** ORT cannot cancel a native run. A camera/language reset must wait for that
 * run and its tensor cleanup before reusing the cached session. Cancelled
 * waiters allocate no tensors and remove themselves immediately.
 */
export async function withLandmarkInference<T>(session: ort.InferenceSession, options: InferenceOptions, run: () => Promise<T>) {
  options.signal?.throwIfAborted();
  // Queue wait belongs to the inference watchdog, never the download budget.
  options.onPhase?.("inference");
  let previous: Lane | undefined;
  while ((previous = running.get(session))) {
    await waitForRun(previous, options.signal);
    options.signal?.throwIfAborted();
  }
  options.signal?.throwIfAborted();
  const lane: Lane = { waiters: new Set() };
  running.set(session, lane);
  try {
    const result = await run();
    options.signal?.throwIfAborted();
    return result;
  } finally {
    running.delete(session);
    for (const done of [...lane.waiters]) done();
  }
}
