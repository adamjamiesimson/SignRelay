/// <reference lib="webworker" />
import { FingerspellingCtcRuntime, CTC_MAX_FRAMES, CTC_FEATURES, type CtcContract } from "../lib/fingerspelling-ctc-runtime";

let runtime: FingerspellingCtcRuntime | null = null;
let epoch = 0, busy = false;
let queued: { features: Float32Array; frames: number; requestId: number; epoch: number } | null = null;
let loading: AbortController | null = null;

async function pump() {
  if (busy || !queued || !runtime) return;
  const job = queued, model = runtime; queued = null; busy = true;
  try {
    const result = await model.predict(job.features,job.frames);
    if (job.epoch === epoch && runtime === model) self.postMessage({type:"result",requestId:job.requestId,epoch,...result});
  } catch (error) {
    if (job.epoch === epoch) self.postMessage({type:"fault",epoch,message:String(error)});
  } finally { busy = false; void pump(); }
}

self.onmessage = async ({data}: MessageEvent) => {
  if (data.type === "reset") {
    epoch++; queued = null; self.postMessage({type:"reset",epoch}); return;
  }
  if (data.type === "init") {
    const generation = ++epoch; queued = null;
    loading?.abort(); const controller = new AbortController(); loading = controller;
    // Host must terminate this worker to interrupt a native ORT call. Do not
    // release a session underneath an in-flight run.
    if (busy) { self.postMessage({type:"fault",epoch,message:"Terminate and replace a busy worker before loading another model"}); return; }
    const old = runtime; runtime = null; await old?.close();
    try {
      const next = await FingerspellingCtcRuntime.create(data.contract as CtcContract,controller.signal);
      if (generation !== epoch) { await next.close(); return; }
      runtime = next; self.postMessage({type:"ready",epoch});
    } catch (error) {
      if (generation === epoch) self.postMessage({type:"fault",epoch,message:String(error)});
    }
    return;
  }
  if (data.type === "predict" && runtime) {
    if (!(data.features instanceof Float32Array) || !Number.isInteger(data.frames)
      || data.frames < 1 || data.frames > CTC_MAX_FRAMES || data.features.length !== data.frames*CTC_FEATURES
      || !Number.isSafeInteger(data.requestId) || data.epoch !== epoch) return;
    // One native run plus one replaceable latest sequence. No frame backlog.
    queued = {features:data.features,frames:data.frames,requestId:data.requestId,epoch};
    void pump();
  }
};
