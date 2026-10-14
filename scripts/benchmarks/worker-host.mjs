// Browser Worker protocol on real Node threads, for reproducible CPU/lifecycle
// benchmarks. This is not a browser-camera or mobile-performance measurement.
import { Worker, parentPort, workerData } from "node:worker_threads";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export class ThreadWorker {
  onmessage = null;
  onerror = null;
  onmessageerror = null;
  constructor(script, options) {
    const root = typeof options === "string" ? options : workerData?.root ?? process.cwd();
    this.thread = new Worker(new URL(import.meta.url), { workerData: { script, root } });
    this.ready = new Promise((resolve, reject) => {
      this.thread.on("message", data => {
        if (data?.type === "host-ready") resolve(); else this.onmessage?.({ data });
      });
      this.thread.on("error", error => { reject(error); this.onerror?.(error); });
      this.thread.on("messageerror", error => this.onmessageerror?.(error));
    });
  }
  postMessage(message) { void this.ready.then(() => this.thread.postMessage(message), () => {}); }
  terminate() { void this.thread.terminate(); }
}

if (parentPort) {
  globalThis.Worker = ThreadWorker;
  globalThis.self = { onmessage: null, postMessage: message => parentPort.postMessage(message) };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (typeof url === "string" && url.startsWith("/models/")) {
      options?.signal?.throwIfAborted();
      return new Response(await readFile(path.join(workerData.root, "public", url)));
    }
    return originalFetch(url, options);
  };
  const script = workerData.script.startsWith("/workers/")
    ? path.join(workerData.root, "public", workerData.script) : workerData.script;
  await import(pathToFileURL(script).href);
  parentPort.on("message", data => void self.onmessage?.({ data }));
  parentPort.postMessage({ type: "host-ready" });
}
