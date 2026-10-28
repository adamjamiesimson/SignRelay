// Local development traces in; aggregate counters out. Never emits coordinates.
import { readFileSync } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
import { analyzeAslStarter, validHand } from "../../lib/asl-starter-recognition";
import { appendObservation, recentContinuousFrames } from "../../lib/frame-timing";
import { analyzeSignMotion } from "../../lib/sign-motion";
import { decideAsl2000, prepareTgcnInput, runPackedTgcn, type TgcnManifest } from "../../lib/asl1000-runtime";
import { candidateContinuity, summarizeHandContinuity, summarizeTrackerBehavior, triageAslAbstention } from "./asl-observation-triage.mjs";
import type { VisionFrame, WorkerAnalysis, WorkerMessage } from "../../lib/vision-types";

type ResultRow = {
  trial_id: string; recording_sha256: string; evaluation_split: string;
  frames: number; analyses: number; expected_gloss: string; accepted_glosses: string[];
  status: string; errors: string[]; worker_sha256: string; source_commit: string;
};
type Trace = {
  trial_id: string; recording_sha256: string;
  row: { recording_sha256: string; frames: number; analyses: number };
  events: ({ type: "frame"; frame: VisionFrame } | { type: "worker"; message: WorkerMessage })[];
};
type ModelDecision = ReturnType<typeof decideAsl2000>;
/** Runs the shipped ASL-2000 graph and production gate on a frame sequence. */
export type AslModelProbe = (sequence: VisionFrame[]) => ModelDecision;

export function loadAslModelProbe(root = "public/models/asl2000-tgcn"): AslModelProbe {
  const manifest = JSON.parse(readFileSync(join(root, "model.json"), "utf8")) as TgcnManifest;
  const labels = JSON.parse(readFileSync(join(root, "labels.json"), "utf8")) as string[];
  const bytes = gunzipSync(Buffer.concat(manifest.binaryParts.map(name => readFileSync(join(root, name)))));
  const binary = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return sequence => decideAsl2000(runPackedTgcn(manifest, binary, labels,
    prepareTgcnInput(sequence, manifest.sequenceLength)), labels);
}

const runs = (items: string[]) => items.reduce<string[]>((result, item, index) => {
  if (index && items[index - 1] === item) {
    const [label, count] = result[result.length - 1].split(":");
    result[result.length - 1] = `${label}:${Number(count) + 1}`;
  } else result.push(`${item}:1`);
  return result;
}, []).join(" ");
const rounded = (value: number) => Math.round(value * 1000) / 1000;

const counts = (items: string[]) => Object.fromEntries([...new Set(items)].sort()
  .map(key => [key, items.filter(item => item === key).length]));

export function summarizeAslTrace(trace: Trace, row: ResultRow, modelProbe?: AslModelProbe) {
  if (row.evaluation_split !== "development") throw new Error("Only development traces may be analyzed");
  if (trace.trial_id !== row.trial_id || trace.recording_sha256 !== row.recording_sha256
    || trace.row.recording_sha256 !== row.recording_sha256) throw new Error("Trace/result recording identity differs");
  if (row.status !== "complete" || row.errors.length) throw new Error("Incomplete trial cannot establish a diagnosis");
  const frames = trace.events.flatMap(event => event.type === "frame" ? [event.frame] : []);
  const analyses = trace.events.flatMap(event => event.type === "worker" && event.message.type === "analysis"
    ? [event.message as WorkerAnalysis] : []);
  if (!frames.length || frames.length !== row.frames || frames.length !== trace.row.frames
    || analyses.length !== row.analyses || analyses.length !== trace.row.analyses) throw new Error("Trace/result counters differ");
  if (frames.some((frame, i) => !Number.isFinite(frame.timestamp)
    || i > 0 && frame.timestamp <= frames[i - 1].timestamp)) throw new Error("Non-monotonic source timestamps");

  let longestRun = 0, run = 0, eligibleEndpoints = 0;
  const spans: number[] = [], proposalLabels: string[] = [], incompleteLabels: string[] = [];
  let firstHand: number | null = null, lastHand: number | null = null, ambiguousPrefixes = 0;
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    if (frame.hands.some(validHand)) {
      run++; longestRun = Math.max(longestRun, run);
      firstHand ??= frame.timestamp; lastHand = frame.timestamp;
    } else run = 0;
    const history = frames.slice(Math.max(0, i - 119), i + 1);
    let eligible = false;
    for (const duration of [650, 1100, 1700, 2600]) for (const side of ["Left", "Right", "Unknown"] as const) {
      const recent = recentContinuousFrames(history, duration,
        f => f.hands.some(hand => hand.handedness === side && validHand(hand)));
      const tracked = recent.filter(f => f.hands.some(hand => hand.handedness === side && validHand(hand)));
      const span = tracked.length ? tracked.at(-1)!.timestamp - tracked[0].timestamp : 0;
      spans.push(span);
      if (tracked.length >= 5 && tracked.length / recent.length >= 0.6 && span >= 160) eligible = true;
    }
    if (eligible) eligibleEndpoints++;
    // An abstaining worker never consumes a confirmed movement. For accepted
    // controls, do not pretend an unconsumed prefix replay is the real worker.
    if (!row.accepted_glosses.length) {
      const result = analyzeAslStarter(history);
      proposalLabels.push(...result.labels); incompleteLabels.push(...result.incompleteLabels);
      if (result.ambiguousOpenPalm) ambiguousPrefixes++;
    }
  }
  // Rebuild the worker's own bounded history and motion gate offline. Only an
  // abstaining worker never clears its history, so accepted trials are skipped.
  const history: VisionFrame[] = [];
  const readySequences: VisionFrame[][] = [];
  const replayedReasons: string[] = [];
  for (const frame of frames) {
    appendObservation(history, frame);
    const motion = analyzeSignMotion(history);
    replayedReasons.push(motion.reason);
    if (motion.ready) readySequences.push([...motion.sequence]);
  }
  let modelGate = null;
  if (modelProbe && !row.accepted_glosses.length) {
    const decisions = readySequences.map(sequence => modelProbe(sequence));
    // Diagnostic only: what the model says about the longest tracked episode
    // if the motion gate were not consulted. Not a production path.
    let best: VisionFrame[] = [], current: VisionFrame[] = [];
    for (const frame of frames) {
      if (frame.hands.some(validHand)) { current.push(frame); if (current.length > best.length) best = current; }
      else current = [];
    }
    const ungated = best.length >= 6 ? modelProbe(best) : null;
    const expected = row.expected_gloss.trim().toUpperCase();
    modelGate = {
      ready_prefixes: readySequences.length,
      gated_decisions: decisions.length,
      gated_accepted_labels: counts(decisions.filter(d => d.accepted).map(d => d.label)),
      gated_top_labels: counts(decisions.map(d => d.label)),
      gated_expected_top: decisions.filter(d => d.label.trim().toUpperCase() === expected).length,
      ungated_longest_episode: ungated && { frames: best.length, top_label: ungated.label,
        confidence: rounded(ungated.confidence), margin: rounded(ungated.margin), passes_gate: ungated.accepted,
        expected_top: ungated.label.trim().toUpperCase() === expected },
    };
  }
  const handContinuity = summarizeHandContinuity(frames, (frame: VisionFrame) => frame.hands.some(validHand));
  const candidateRuns = candidateContinuity(analyses, row.expected_gloss);
  const report = {
    trial_id: row.trial_id, recording_sha256: row.recording_sha256,
    worker_sha256: row.worker_sha256, source_commit: row.source_commit,
    expected_gloss: row.expected_gloss, accepted_glosses: row.accepted_glosses,
    frames: frames.length, worker_analyses: analyses.length,
    valid_hand_frames: frames.filter(f => f.hands.some(validHand)).length,
    longest_consecutive_hand_frames: longestRun,
    first_hand_ms: firstHand === null ? null : Math.round(firstHand - frames[0].timestamp),
    last_hand_ms: lastHand === null ? null : Math.round(lastHand - frames[0].timestamp),
    maximum_continuous_hand_span_ms: Math.round(Math.max(0, ...spans)),
    starter_tracking_eligible_endpoints: eligibleEndpoints,
    worker_motion_reasons: counts(analyses.map(message => message.motionReason ?? "unreported")),
    worker_motion_runs: runs(analyses.map(message => message.motionReason ?? "unreported")),
    replayed_motion_reasons_match_worker: replayedReasons.join() === analyses.map(message => message.motionReason ?? "unreported").join(),
    model_gate_probe: modelGate,
    worker_candidates: counts(analyses.flatMap(message => message.candidate ? [message.candidate] : [])),
    worker_candidate_sources: counts(analyses.flatMap(message => message.source ? [message.source] : [])),
    worker_ambiguity_analyses: analyses.filter(message => message.feedback?.includes("more than one sign")).length,
    hand_continuity: handContinuity,
    tracker_behavior: frames.length >= 2 ? summarizeTrackerBehavior(frames, validHand) : null,
    candidate_continuity: candidateRuns,
    abstention_prefix_probe: row.accepted_glosses.length ? null : {
      labels: counts(proposalLabels), incomplete_labels: counts(incompleteLabels), ambiguous_prefixes: ambiguousPrefixes,
    },
    note: "Aggregate development diagnostics. Missing-hand runs may include normal rests/occlusion and do not establish which part of a sign was lost. Starter prefix probes are not model inference. The model gate probe reruns the shipped ASL-2000 graph offline on development frames; it is not a new accuracy result and its ungated episode is not a production path.",
  };
  return { ...report, abstention_triage: triageAslAbstention(report) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [directory, results, output] = process.argv.slice(2);
  if (!directory || !results || !output) throw new Error("Supply ignored trace directory, results.jsonl and new aggregate output.json");
  const rows: ResultRow[] = (await readFile(results, "utf8")).trim().split(/\r?\n/).map(line => JSON.parse(line));
  const available = new Set(await readdir(directory));
  const probe = process.argv.includes("--model-probe") ? loadAslModelProbe() : undefined;
  const report = [];
  for (const row of rows) {
    const name = `${row.recording_sha256}.json`;
    if (!/^[a-f0-9]{64}\.json$/.test(name) || !available.has(name)) throw new Error(`Missing trace: ${row.trial_id}`);
    report.push(summarizeAslTrace(JSON.parse(await readFile(join(directory, name), "utf8")), row, probe));
  }
  await writeFile(output, JSON.stringify({ diagnostic_only: true, trials: report }, null, 2) + "\n", { flag: "wx" });
  console.log(`Wrote aggregate counters for ${report.length} development recordings; no landmarks exported.`);
}
