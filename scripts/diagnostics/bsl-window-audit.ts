// Where do the model's input frames fall relative to the signing movement?
// Run on captured traces: npx esbuild ... (see docs/bsl-sprint-2026-11-24/AUDIT.md).
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { analyzeGenericSignMotion } from "../../lib/asl100-runtime";
import { buildBslWindows, resampleBslTimeline, selectSignSpan, BSL_FRAMES } from "../../lib/bsl-pose2sign-input";
import type { VisionFrame } from "../../lib/vision-types";

const dir = process.argv[2];
const rows: Record<string, unknown>[] = [];
for (const file of readdirSync(dir).filter(name => name.endsWith(".json"))) {
  const trace = JSON.parse(readFileSync(path.join(dir, file), "utf8")) as { trial_id: string; frames: VisionFrame[] };
  const buffer: VisionFrame[] = [];
  for (const frame of trace.frames) {
    buffer.push(frame); if (buffer.length > 80) buffer.shift();
    if (!analyzeGenericSignMotion(buffer).ready) continue;
    // Legacy: the last 16 *observed* frames at this moment.
    const legacy = buffer.slice(-BSL_FRAMES);
    const timeline = resampleBslTimeline(buffer);
    const span = selectSignSpan(timeline.frames);
    const spanStart = span ? timeline.times[span.start] : NaN, spanEnd = span ? timeline.times[span.end] : NaN;
    const legacyInSpan = legacy.filter(item => item.timestamp >= spanStart && item.timestamp <= spanEnd).length;
    const v2 = buildBslWindows(buffer);
    rows.push({ trial: trace.trial_id, observed_fps: Number((1000 * (buffer.length - 1) / (buffer.at(-1)!.timestamp - buffer[0].timestamp)).toFixed(1)),
      legacy_window_ms: Math.round(legacy.at(-1)!.timestamp - legacy[0].timestamp), movement_ms: Math.round(spanEnd - spanStart),
      legacy_frames_in_movement: `${legacyInSpan}/${BSL_FRAMES}`, legacy_frames_after_movement: legacy.filter(item => item.timestamp > spanEnd).length,
      v2_windows: v2.windows.length, v2_movement_coverage: span ? Number((Math.min(1, (v2.starts.at(-1)! + BSL_FRAMES - v2.starts[0]) / (span.end - span.start + 1))).toFixed(2)) : 0,
      label_corrections: `${timeline.slotDisagreements}/${timeline.observedHandFrames}` });
    break;
  }
}
console.log(JSON.stringify(rows, null, 1));
