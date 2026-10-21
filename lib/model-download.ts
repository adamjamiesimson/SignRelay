export const DOWNLOAD_TIMEOUT_MS = 300000;
export const DOWNLOAD_IDLE_TIMEOUT_MS = 45000;

/** Download completely before constructing a runtime. Incomplete bytes never
 * enter the model cache. A progressing slow connection gets five minutes;
 * a silent/disconnected stream times out independently of model inference.
 */
export async function downloadModelBytes(url: string, options: {
  signal?: AbortSignal; timeoutMs?: number; idleMs?: number; maxBytes?: number;
} = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort(options.signal?.reason);
  options.signal?.throwIfAborted();
  options.signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(() => controller.abort(new Error("Model download deadline exceeded")), options.timeoutMs ?? DOWNLOAD_TIMEOUT_MS);
  let idle: ReturnType<typeof setTimeout>;
  const progress = () => {
    clearTimeout(idle);
    idle = setTimeout(() => controller.abort(new Error("Model download stopped making progress")), options.idleMs ?? DOWNLOAD_IDLE_TIMEOUT_MS);
  };
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const cancelReader = () => { void reader?.cancel(controller.signal.reason).catch(() => {}); };
  controller.signal.addEventListener("abort", cancelReader, { once: true });
  try {
    progress();
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok || !response.body) throw new Error(`Model download failed (${response.status})`);
    reader = response.body.getReader();
    const chunks: Uint8Array[] = []; let size = 0;
    const maxBytes = options.maxBytes ?? 128 * 1024 * 1024;
    const expected = Number(response.headers.get("content-length")) || 0;
    if (expected > maxBytes) throw new Error("Model exceeds download size limit");
    while (true) {
      const { value, done } = await reader.read();
      controller.signal.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error("Model exceeds download size limit");
      chunks.push(value); progress();
    }
    if (!size || (expected && !response.headers.get("content-encoding") && size !== expected)) {
      throw new Error("Model download was incomplete");
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
  } finally {
    controller.abort();
    if (reader) { void reader.cancel().catch(() => {}); reader.releaseLock(); }
    clearTimeout(timeout); clearTimeout(idle!);
    controller.signal.removeEventListener("abort", cancelReader);
    options.signal?.removeEventListener("abort", abort);
  }
}
