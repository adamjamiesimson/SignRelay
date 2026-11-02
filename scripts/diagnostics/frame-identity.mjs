// Frame-identity encoding and capture-schedule analysis for the camera
// diagnostics. Synthetic test patterns only: no person, landmarks or recording.
//
// Each generated frame carries its source index as a 12-bit code drawn in two
// rows of large blocks (the second row is the bitwise inverse, so a decode is
// rejected unless both rows agree). Large blocks survive the browser's own
// scaling and 4:2:0 chroma subsampling.
import { writeFileSync } from "node:fs";

export const CODE_BITS = 12;

/** Write a 4:2:0 Y4M test pattern. Only the luma plane carries the code. */
export function writeIdentityY4m(path, { width = 640, height = 480, fps = 30, frames = 600 } = {}) {
  if (frames >= 2 ** CODE_BITS) throw new Error("Too many frames for the identity code");
  const header = Buffer.from(`YUV4MPEG2 W${width} H${height} F${fps}:1 Ip A1:1 C420jpeg\n`);
  const lumaSize = width * height, chromaSize = (width / 2) * (height / 2);
  const chunks = [header];
  for (let index = 0; index < frames; index++) {
    const luma = Buffer.alloc(lumaSize, 128);
    const block = Math.floor(width / CODE_BITS);
    for (let bit = 0; bit < CODE_BITS; bit++) {
      const on = (index >> bit) & 1;
      for (const [row, value] of [[0, on], [1, 1 - on]]) {
        const top = Math.floor(height * (0.2 + row * 0.3)), level = value ? 235 : 16;
        for (let y = top; y < top + Math.floor(height * 0.2); y++) luma.fill(level, y * width + bit * block, y * width + (bit + 1) * block);
      }
    }
    chunks.push(Buffer.from("FRAME\n"), luma, Buffer.alloc(chromaSize * 2, 128));
  }
  writeFileSync(path, Buffer.concat(chunks));
}

/** Browser-side decoder source (string) shared by page and worker probes. */
export const DECODE_SOURCE = `function __decodeIdentity(rgba, width, height) {
  const bits = ${CODE_BITS}, block = width / bits;
  let code = 0, inverse = 0;
  for (let bit = 0; bit < bits; bit++) {
    const x = Math.floor((bit + 0.5) * block);
    for (const row of [0, 1]) {
      const y = Math.floor(height * (0.3 + row * 0.3));
      const at = (y * width + x) * 4, luma = (rgba[at] + rgba[at + 1] + rgba[at + 2]) / 3;
      if (luma > 128) { if (row) inverse |= 1 << bit; else code |= 1 << bit; }
    }
  }
  return (code ^ inverse) === (1 << bits) - 1 ? code : -1;
}`;

/**
 * Compare the frames the tracker actually received with the decoded camera
 * frames the page presented. `presented` maps source index -> presentation
 * metadata; `tracked` is the ordered list of {index, timestamp} the tracker saw.
 * The analysis is purely about schedule and timing, never landmarks.
 */
export function analyseSchedule(tracked, presented, sourceFps) {
  const valid = tracked.filter(frame => frame.index >= 0);
  let duplicates = 0, backwards = 0, skippedSourceFrames = 0;
  const timestampErrors = [], intervalErrors = [];
  for (let i = 0; i < valid.length; i++) {
    const frame = valid[i], previous = valid[i - 1];
    const source = presented.get(frame.index);
    if (source) timestampErrors.push(frame.timestamp - source.reference);
    if (!previous) continue;
    const step = frame.index - previous.index;
    if (step === 0) duplicates++;
    else if (step < 0) backwards++; // looped source or reordering; excluded from skip counts
    else skippedSourceFrames += step - 1;
    if (step > 0) intervalErrors.push((frame.timestamp - previous.timestamp) - step * 1000 / sourceFps);
  }
  const sorted = values => [...values].sort((a, b) => a - b);
  const quantile = (values, q) => { const s = sorted(values); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : null; };
  const median = values => quantile(values, 0.5);
  const centred = timestampErrors.map(value => value - (median(timestampErrors) ?? 0));
  const absolute = values => values.map(Math.abs);
  // Observer-independent check: every tracked timestamp should differ from the
  // decoded frame's own mediaTime by one constant clock offset. Deviations are
  // pixel/timestamp mismatches, reported in source-frame units.
  const offsets = valid.flatMap(frame => { const source = presented.get(frame.index); return source ? [frame.timestamp - source.mediaTime * 1000] : []; });
  const modal = median(offsets) ?? 0;
  const mismatches = offsets.map(value => (value - modal) * sourceFps / 1000).filter(frames => Math.abs(frames) > 0.03);
  // Informational: the fake camera stamps its own capture ticks, which can slip.
  const observerSteps = [...presented.values()].sort((a, b) => a.index - b.index);
  const sourcePacingIrregular = observerSteps.slice(1).filter((frame, i) => Math.abs((frame.index - observerSteps[i].index) - (frame.mediaTime - observerSteps[i].mediaTime) * sourceFps) > 0.2).length;
  return {
    trackedFrames: tracked.length,
    mediaClockMismatches: mismatches.length,
    mediaClockMismatchFrames: mismatches.map(frames => Math.round(frames * 100) / 100).slice(0, 20),
    sourcePacingIrregular,
    undecodable: tracked.length - valid.length,
    duplicates,
    duplicateFraction: valid.length > 1 ? duplicates / (valid.length - 1) : 0,
    backwards,
    skippedSourceFrames,
    timestampOffsetMedianMs: median(timestampErrors),
    timestampJitterMs: { median: median(absolute(centred)), p95: quantile(absolute(centred), 0.95), max: Math.max(0, ...absolute(centred)) },
    intervalErrorMs: { median: median(absolute(intervalErrors)), p95: quantile(absolute(intervalErrors), 0.95), max: Math.max(0, ...absolute(intervalErrors)) },
  };
}
