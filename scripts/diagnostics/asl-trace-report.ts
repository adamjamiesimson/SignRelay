// Local development traces in; aggregate counters out. Never emits coordinates.
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { analyzeAslStarter, validHand } from "../../lib/asl-starter-recognition";
import { recentContinuousFrames } from "../../lib/frame-timing";
import { candidateContinuity, summarizeHandContinuity, triageAslAbstention } from "./asl-observation-triage.mjs";
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
const counts = (items: string[]) => Object.fromEntries([...new Set(items)].sort()
  .map(key => [key, items.filter(item => item === key).length]));

export function summarizeAslTrace(trace: Trace, row: ResultRow) {
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
  const handContinuity = summarizeHandContinuity(frames, frame => frame.hands.some(validHand));
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
    worker_candidates: counts(analyses.flatMap(message => message.candidate ? [message.candidate] : [])),
    worker_candidate_sources: counts(analyses.flatMap(message => message.source ? [message.source] : [])),
    worker_ambiguity_analyses: analyses.filter(message => message.feedback?.includes("more than one sign")).length,
    hand_continuity: handContinuity,
    candidate_continuity: candidateRuns,
    abstention_prefix_probe: row.accepted_glosses.length ? null : {
      labels: counts(proposalLabels), incomplete_labels: counts(incompleteLabels), ambiguous_prefixes: ambiguousPrefixes,
    },
    note: "Aggregate development diagnostics. Missing-hand runs may include normal rests/occlusion and do not establish which part of a sign was lost. Prefix probes are not model inference or a new accuracy result.",
  };
  return { ...report, abstention_triage: triageAslAbstention(report) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [directory, results, output] = process.argv.slice(2);
  if (!directory || !results || !output) throw new Error("Supply ignored trace directory, results.jsonl and new aggregate output.json");
  const rows: ResultRow[] = (await readFile(results, "utf8")).trim().split(/\r?\n/).map(line => JSON.parse(line));
  const available = new Set(await readdir(directory));
  const report = [];
  for (const row of rows) {
    const name = `${row.recording_sha256}.json`;
    if (!/^[a-f0-9]{64}\.json$/.test(name) || !available.has(name)) throw new Error(`Missing trace: ${row.trial_id}`);
    report.push(summarizeAslTrace(JSON.parse(await readFile(join(directory, name), "utf8")), row));
  }
  await writeFile(output, JSON.stringify({ diagnostic_only: true, trials: report }, null, 2) + "\n", { flag: "wx" });
  console.log(`Wrote aggregate counters for ${report.length} development recordings; no landmarks exported.`);
}
