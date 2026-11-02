// Deterministic offline replay of the post-tracking fingerspelling pipeline:
//   landmark trace -> FingerspellingCapture -> 132-feature tensor -> ONNX (WASM)
//   -> production decoding/policy (interpretCtcLogits) -> stage fingerprints.
// Tracking (MediaPipe) is NOT re-run: a trace fixes its output, which is how
// capture-stage variation is separated from model behaviour.
//
// Inputs are LOCAL files only. A trace contains landmarks; keep it under work/
// (git-ignored) and never upload or publish it. The printed report contains
// fingerprints, frame counts, timing and decoded status, never landmarks; it
// prints decoded text only with --show-text.
//
// usage: node scripts/diagnostics/run-fingerspelling-replay.mjs
//          <input.json> [other.json] [--repeat N] [--show-text]
// input: a trace from FingerspellingCapture.trace(), or a captured tensor
//        {frames, features:number[]} as written by fingerspelling-camera-browser.mjs.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import * as ort from "onnxruntime-web";
import { FingerspellingCapture, type FingerspellingTrace } from "../../lib/fingerspelling-capture";
import { interpretCtcLogits, CTC_VOCABULARY } from "../../lib/fingerspelling-ctc-runtime";
import { FINGERSPELLING_CTC_MODEL } from "../../lib/fingerspelling-model";
import { firstDivergentStage, type StageFingerprints } from "../../lib/pipeline-fingerprint";

export type Replay = { input: string; kind: "trace" | "tensor"; frames: number; fingerprints: StageFingerprints; status: string; text?: string; captureError?: string };

export async function createSession() {
  const contract = FINGERSPELLING_CTC_MODEL;
  const bytes = readFileSync(new URL("../../public" + contract.url, import.meta.url));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (bytes.length !== contract.bytes || sha256 !== contract.sha256) throw new Error("Installed fingerspelling model does not match its contract");
  ort.env.wasm.numThreads = 1;
  return ort.InferenceSession.create(bytes, { executionProviders: ["wasm"] });
}

export async function replay(session: ort.InferenceSession, path: string, showText = false): Promise<Replay> {
  return replayData(session, JSON.parse(readFileSync(path, "utf8")), path, showText);
}

/** Same as replay() for an in-memory trace or tensor (never written to disk). */
export async function replayData(session: ort.InferenceSession, data: Record<string, unknown> & { schema?: string; frames?: number; features?: number[] }, path: string, showText = false): Promise<Replay> {
  const contract = FINGERSPELLING_CTC_MODEL, width = contract.features ?? 66;
  let features: Float32Array, frames: number, fingerprints: StageFingerprints = {};
  const kind = data.schema === "signrelay-fingerspelling-trace-v1" ? "trace" : "tensor";
  if (kind === "trace") {
    const capture = FingerspellingCapture.fromTrace(data as unknown as FingerspellingTrace);
    fingerprints = { ...capture.diagnostics().fingerprints };
    try { ({ features, frames } = capture.finish()); }
    catch (error) { return { input: path, kind, frames: capture.diagnostics().frames, fingerprints, status: "quality-rejected", captureError: String(error) }; }
  } else {
    if (!Number.isInteger(data.frames) || !Array.isArray(data.features) || data.features.length !== data.frames! * width) throw new Error(`${path}: not a ${width}-feature captured tensor`);
    features = Float32Array.from(data.features); frames = data.frames!;
  }
  const started = performance.now();
  const outputs = await session.run({ features: new ort.Tensor("float32", features, [1, frames, width]) });
  const logits = outputs.logits;
  if (logits.dims.join() !== [1, frames, CTC_VOCABULARY.length].join()) throw new Error("Unexpected logits shape");
  const result = interpretCtcLogits(logits.data as Float32Array, frames, features, contract, performance.now() - started, started);
  for (const value of Object.values(outputs)) value.dispose();
  return { input: path, kind, frames, fingerprints: { ...fingerprints, ...result.fingerprints }, status: result.status, ...(showText ? { text: result.text } : {}) };
}

if (process.argv[1]?.includes("replay-fingerspelling-trace")) {
  const args = process.argv.slice(2);
  const repeat = Number(args[args.indexOf("--repeat") + 1] ?? 1) || 1, showText = args.includes("--show-text");
  const inputs = args.filter((arg, i) => !arg.startsWith("--") && args[i - 1] !== "--repeat");
  if (!inputs.length || inputs.length > 2) throw new Error("usage: <input.json> [other.json] [--repeat N] [--show-text]");
  const session = await createSession();
  try {
    const runs: Replay[][] = [];
    for (const input of inputs) {
      const attempts: Replay[] = [];
      for (let i = 0; i < (inputs.length === 1 ? repeat : 1); i++) attempts.push(await replay(session, input, showText));
      runs.push(attempts);
    }
    const report: Record<string, unknown> = { kind: "offline replay of captured observations; not tracking, not webcam accuracy", model: FINGERSPELLING_CTC_MODEL.sha256, runs };
    if (inputs.length === 1) report.deterministic = runs[0].every(run => firstDivergentStage(run.fingerprints, runs[0][0].fingerprints) === null && run.status === runs[0][0].status);
    else report.firstDivergentStage = firstDivergentStage(runs[0][0].fingerprints, runs[1][0].fingerprints);
    console.log(JSON.stringify(report, null, 1));
  } finally { await session.release(); }
}
