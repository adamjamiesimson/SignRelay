import * as ort from "onnxruntime-web";
import {CTC_VOCABULARY} from "./fingerspelling-vocabulary";
import {visualBeam,visualConfidenceFeatures,exactSequenceProbability,type SequenceCalibration} from "./fingerspelling-decoding";
export {CTC_VOCABULARY} from "./fingerspelling-vocabulary";

export const CTC_FEATURES = 66;
export const CTC_MAX_FRAMES = 320;
export type CtcContract = { url:string;bytes:number;sha256:string;features?:number;presenceIndex?:number;featureVersion?:"v2"|"v3";decoder?:"greedy"|"beam8";
 calibration?:SequenceCalibration;policy?:{threshold:number|null;reviewOnly?:boolean;policy:{minimumTextLength:number;maximumTextLength:number;minVisibleFraction:number;minFrames:number;maxFrames:number}} };
export type CtcResult = { text: string; uncalibratedScore: number; inferenceMs: number; status: "candidate" | "no-hand" | "uncertain"; estimatedExactProbability?:number; processingMs?:number; abstentionReason?:string };

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

/** Actual worker-only WASM inference with an explicit preprocessing contract.
 * Only a worker may create this runtime; no main-thread compatibility fallback.
 */
export class FingerspellingCtcRuntime {
  private busy = false;
  private closed = false;
  private constructor(private session:ort.InferenceSession,private contract:CtcContract) {}
  get inputFeatures(){return this.contract.features??66;}
  get presenceIndex(){return this.contract.presenceIndex??65;}
  static async create(contract: CtcContract, signal?: AbortSignal) {
    if (typeof document !== "undefined") throw new Error("Fingerspelling inference requires a worker");
    const count=contract.features??66,presence=contract.presenceIndex??65;
    if(!((count===66&&presence===65&&(contract.featureVersion??"v2")==="v2")||(count===132&&presence===130&&contract.featureVersion==="v3"))
      || !["greedy","beam8"].includes(contract.decoder??"greedy"))throw new Error("Invalid fingerspelling feature configuration");
    if(contract.calibration){
      const c=contract.calibration;
      if(c.means.length!==7||c.standardDeviations.length!==7||c.coefficients.length!==7||![...c.means,...c.coefficients,c.intercept].every(Number.isFinite)
       ||!c.standardDeviations.every(v=>Number.isFinite(v)&&v>0))throw new Error("Invalid calibration contract");
      const policy=contract.policy;
      if(!policy||(policy.threshold!==null&&(!Number.isFinite(policy.threshold)||policy.threshold<0||policy.threshold>1))
       ||![policy.policy.minimumTextLength,policy.policy.maximumTextLength,policy.policy.minVisibleFraction,policy.policy.minFrames,policy.policy.maxFrames].every(Number.isFinite))throw new Error("Invalid acceptance contract");
    }
    const bytes = await verifiedBytes(contract,signal);
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.wasmPaths = "/workers/";
    const session = await ort.InferenceSession.create(bytes, { executionProviders: ["wasm"] });
    if (signal?.aborted) { await session.release(); signal.throwIfAborted(); }
    if (session.inputNames.length !== 1 || session.inputNames[0] !== "features"
      || session.outputNames.length !== 1 || session.outputNames[0] !== "logits") {
      await session.release(); throw new Error("Fingerspelling model IO contract mismatch");
    }
    return new FingerspellingCtcRuntime(session,contract);
  }
  async predict(features: Float32Array, frames: number, observeLogits?: (values: Float32Array) => void): Promise<CtcResult> {
    if (this.closed || this.busy) throw new Error("Fingerspelling runtime unavailable or busy");
    if (!Number.isInteger(frames) || frames < 1 || frames > CTC_MAX_FRAMES
      || features.length !== frames * this.inputFeatures || !features.every(Number.isFinite)) {
      throw new Error("Invalid fingerspelling sequence");
    }
    let hands = 0;
    for (let t=0;t<frames;t++) if (features[t*this.inputFeatures+this.presenceIndex] === 1) hands++;
    if (!hands) return { text: "", uncalibratedScore: 0, inferenceMs: 0, status: "no-hand" };
    this.busy = true;
    const input = new ort.Tensor("float32",features,[1,frames,this.inputFeatures]);
    let outputs: Record<string,ort.Tensor> | undefined;
    try {
      const start = performance.now();
      outputs = await this.session.run({features:input});
      const inferenceMs = performance.now()-start;
      const tensor = outputs.logits;
      if (tensor.type !== "float32" || tensor.dims.length !== 3 || tensor.dims[0] !== 1
        || tensor.dims[1] !== frames || tensor.dims[2] !== CTC_VOCABULARY.length) throw new Error("Invalid fingerspelling tensor");
      observeLogits?.(tensor.data as Float32Array);
      const logits=tensor.data as Float32Array;
      const result=decodeCtc(logits,frames);
      if(this.contract.decoder==="beam8")result.text=visualBeam(logits,frames);
      const stats=visualConfidenceFeatures(logits,frames,features,this.inputFeatures,this.presenceIndex,result.text);
      const calibration=this.contract.calibration,policy=this.contract.policy;
      const estimatedExactProbability=calibration?exactSequenceProbability(stats,calibration):undefined;
      if(policy){
        const rules=policy.policy;
        const structurallyEligible=frames>=rules.minFrames&&frames<=rules.maxFrames&&stats[5]>=rules.minVisibleFraction
          &&result.text.length>=rules.minimumTextLength&&result.text.length<=rules.maximumTextLength;
        if(!structurallyEligible)return {text:"",uncalibratedScore:0,inferenceMs,status:"uncertain",estimatedExactProbability,abstentionReason:"Capture is outside the evaluated quality or text-length range.",processingMs:performance.now()-start};
        const qualified=estimatedExactProbability!==undefined&&policy.threshold!==null&&estimatedExactProbability>=policy.threshold;
        if(policy.reviewOnly||!qualified){
          return {...result,text:policy.reviewOnly?result.text:"",inferenceMs,status:"uncertain",estimatedExactProbability,
            abstentionReason:policy.reviewOnly&&qualified?"Research-only candidate. Conditional text confidence does not establish rejection of ordinary hand movement; check every character.":policy.threshold===null?"Uncertain capture. No validated acceptance threshold is available; check every character before confirming.":"Uncertain capture. Review carefully or recapture.",processingMs:performance.now()-start};
        }
      }
      return {...result,inferenceMs,status:"candidate",estimatedExactProbability,processingMs:performance.now()-start};
    } finally {
      input.dispose();
      if (outputs) for (const value of new Set(Object.values(outputs))) value.dispose();
      this.busy = false;
    }
  }
  async close() { if (!this.closed) { this.closed = true; await this.session.release(); } }
}
