import * as ort from "onnxruntime-web";

export const CTC_VOCABULARY = ["<blank>", ..." ABCDEFGHIJKLMNOPQRSTUVWXYZ"];
export const CTC_FEATURES = 66;
export const CTC_MAX_FRAMES = 320;
export type CtcContract = { url: string; bytes: number; sha256: string };
export type CtcResult = { text: string; uncalibratedScore: number; inferenceMs: number; status: "candidate" | "no-hand" };

export function decodeCtc(logits: Float32Array, frames: number) {
  const size = CTC_VOCABULARY.length;
  if (logits.length !== frames * size) throw new Error("Invalid CTC output shape");
  let previous = -1, text = "", score = 0, count = 0;
  for (let t = 0; t < frames; t++) {
    const at = t * size;
    let best = 0, max = -Infinity;
    for (let i = 0; i < size; i++) {
      const value = logits[at+i];
      if (!Number.isFinite(value)) throw new Error("Non-finite CTC output");
      if (value > max) { best = i; max = value; }
    }
    if (best !== 0 && best !== previous) {
      let sum = 0;
      for (let i = 0; i < size; i++) sum += Math.exp(logits[at+i] - max);
      text += CTC_VOCABULARY[best]; score += 1 / sum; count++;
    }
    previous = best;
  }
  // This is a model score, never a calibrated probability of correctness.
  return { text, uncalibratedScore: count ? score/count : 0 };
}

async function verifiedBytes(contract: CtcContract, signal?: AbortSignal) {
  const url = new URL(contract.url, self.location.href);
  if (url.origin !== self.location.origin || !url.pathname.startsWith("/models/asl-fingerspelling/")
    || url.search || url.hash || !/^[a-f0-9]{64}$/.test(contract.sha256)
    || !Number.isSafeInteger(contract.bytes) || contract.bytes < 1 || contract.bytes > 5*1024*1024) {
    throw new Error("Invalid fingerspelling asset contract");
  }
  const response = await fetch(url, { signal, redirect: "error" });
  if (!response.ok || !response.body) throw new Error("Fingerspelling model unavailable");
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const {done,value} = await reader.read();
      if (done) break;
      total += value.length;
      if (total > contract.bytes) throw new Error("Fingerspelling model exceeds reviewed size");
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  if (total !== contract.bytes) throw new Error("Fingerspelling model size mismatch");
  const bytes = new Uint8Array(total);
  let at = 0; for (const chunk of chunks) { bytes.set(chunk,at); at += chunk.length; }
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = [...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,"0")).join("");
  if (hash !== contract.sha256) throw new Error("Fingerspelling model checksum mismatch");
  return bytes;
}

/** Actual WASM inference. The candidate is not installed/default-enabled.
 * Only a worker may create this runtime; no main-thread compatibility fallback.
 */
export class FingerspellingCtcRuntime {
  private busy = false;
  private closed = false;
  private constructor(private session: ort.InferenceSession) {}
  static async create(contract: CtcContract, signal?: AbortSignal) {
    if (typeof document !== "undefined") throw new Error("Fingerspelling inference requires a worker");
    const bytes = await verifiedBytes(contract,signal);
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.wasmPaths = "/workers/";
    const session = await ort.InferenceSession.create(bytes, { executionProviders: ["wasm"] });
    if (signal?.aborted) { await session.release(); signal.throwIfAborted(); }
    if (session.inputNames.length !== 1 || session.inputNames[0] !== "features"
      || session.outputNames.length !== 1 || session.outputNames[0] !== "logits") {
      await session.release(); throw new Error("Fingerspelling model IO contract mismatch");
    }
    return new FingerspellingCtcRuntime(session);
  }
  async predict(features: Float32Array, frames: number, observeLogits?: (values: Float32Array) => void): Promise<CtcResult> {
    if (this.closed || this.busy) throw new Error("Fingerspelling runtime unavailable or busy");
    if (!Number.isInteger(frames) || frames < 1 || frames > CTC_MAX_FRAMES
      || features.length !== frames * CTC_FEATURES || !features.every(Number.isFinite)) {
      throw new Error("Invalid fingerspelling sequence");
    }
    let hands = 0;
    for (let t=0;t<frames;t++) if (features[t*CTC_FEATURES+65] === 1) hands++;
    if (!hands) return { text: "", uncalibratedScore: 0, inferenceMs: 0, status: "no-hand" };
    this.busy = true;
    const input = new ort.Tensor("float32",features,[1,frames,CTC_FEATURES]);
    let outputs: Record<string,ort.Tensor> | undefined;
    try {
      const start = performance.now();
      outputs = await this.session.run({features:input});
      const inferenceMs = performance.now()-start;
      const tensor = outputs.logits;
      if (tensor.type !== "float32" || tensor.dims.length !== 3 || tensor.dims[0] !== 1
        || tensor.dims[1] !== frames || tensor.dims[2] !== CTC_VOCABULARY.length) throw new Error("Invalid fingerspelling tensor");
      observeLogits?.(tensor.data as Float32Array);
      const result = decodeCtc(tensor.data as Float32Array,frames);
      return { ...result, inferenceMs, status: "candidate" };
    } finally {
      input.dispose();
      if (outputs) for (const value of new Set(Object.values(outputs))) value.dispose();
      this.busy = false;
    }
  }
  async close() { if (!this.closed) { this.closed = true; await this.session.release(); } }
}
