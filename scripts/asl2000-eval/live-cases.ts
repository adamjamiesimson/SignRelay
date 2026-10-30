// Condition C, offline step: turn local browser captures into evaluator cases
// and summarise what the real worker did. Coordinates stay in the local cases
// file; the outcomes file holds labels, counts and timings only.
//
// node live-cases.mjs <capture-dir> <cases.jsonl> <outcomes.jsonl>
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { appendObservation } from "../../lib/frame-timing";
import { analyzeSignMotion } from "../../lib/sign-motion";
import { validHand } from "../../lib/asl-starter-recognition";
import type { VisionFrame, WorkerAnalysis, WorkerConfirmation, WorkerMessage } from "../../lib/vision-types";

type Capture = { id: string; worker: string; pauseMs: number; frames?: VisionFrame[]; messages?: (WorkerMessage & { receivedAt: number })[];
  wallMs?: number; error?: string; video?: { width: number; height: number; duration: number } };

const [directory, casesPath, outcomesPath] = process.argv.slice(2);
if (!directory || !casesPath || !outcomesPath) throw new Error("Usage: live-cases <capture-dir> <cases.jsonl> <outcomes.jsonl>");
const cases: string[] = [], outcomes: string[] = [];
const counts = (items: string[]) => items.reduce<Record<string, number>>((all, item) => ({ ...all, [item]: (all[item] ?? 0) + 1 }), {});
for (const name of readdirSync(directory).filter(file => file.endsWith(".json")).sort()) {
  const capture = JSON.parse(readFileSync(join(directory, name), "utf8")) as Capture;
  const frames = capture.frames ?? [];
  const messages = capture.messages ?? [];
  const analyses = messages.filter((m): m is WorkerAnalysis & { receivedAt: number } => m.type === "analysis");
  const confirmations = messages.filter((m): m is WorkerConfirmation & { receivedAt: number } => m.type === "confirmed");
  const history: VisionFrame[] = [];
  const ready: VisionFrame[][] = [];
  for (const frame of frames) {
    appendObservation(history, frame);
    const motion = analyzeSignMotion(history);
    if (motion.ready) ready.push([...motion.sequence]);
  }
  const key = `${capture.id}|${capture.worker}|${capture.pauseMs}`;
  // Cases are evaluated once per clip (frames do not depend on the worker).
  if (frames.length >= 6) cases.push(JSON.stringify({ id: `${key}|complete`, frames }));
  if (ready.length) {
    cases.push(JSON.stringify({ id: `${key}|gated-first`, frames: ready[0] }));
    cases.push(JSON.stringify({ id: `${key}|gated-last`, frames: ready.at(-1) }));
  }
  outcomes.push(JSON.stringify({
    id: capture.id, worker: capture.worker, pauseMs: capture.pauseMs, error: capture.error ?? null,
    frames: frames.length, hand_frames: frames.filter(frame => frame.hands.some(validHand)).length,
    pose_frames: frames.filter(frame => frame.pose.length === 33).length,
    video: capture.video ?? null, wall_ms: capture.wallMs ?? null,
    motion_ready_frames: ready.length,
    worker_motion_reasons: counts(analyses.map(message => message.motionReason ?? "unreported")),
    model_inferences_completed: analyses.filter(message => message.modelMs !== undefined).length,
    model_inference_ms: analyses.flatMap(message => message.modelMs !== undefined ? [Math.round(message.modelMs)] : []),
    model_candidates: counts(analyses.flatMap(message => message.source === "model" && message.candidate ? [message.candidate] : [])),
    starter_candidates: counts(analyses.flatMap(message => message.source === "starter" && message.candidate ? [message.candidate] : [])),
    confirmations: confirmations.map(message => ({ gloss: message.gloss, source: message.source ?? "unknown" })),
  }));
}
writeFileSync(casesPath, cases.join("\n") + (cases.length ? "\n" : ""));
writeFileSync(outcomesPath, outcomes.join("\n") + (outcomes.length ? "\n" : ""));
console.error(JSON.stringify({ captures: outcomes.length, cases: cases.length }));
