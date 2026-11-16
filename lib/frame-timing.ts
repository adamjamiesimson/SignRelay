type Timed = { timestamp: number };

/** Longest gap between two camera frames that still counts as one continuous
 * observation, at any frame rate. */
export const MAX_TRACKING_GAP_MS = 750;

// A slow stream is still continuous. Estimate its cadence without letting one
// long pause redefine what counts as continuous tracking.
export function trackingGapLimit(frames: readonly Timed[]) {
  const intervals = frames.slice(-13).flatMap((frame, index, recent) => {
    const interval = index ? frame.timestamp - recent[index - 1].timestamp : 0;
    return interval > 0 && interval <= MAX_TRACKING_GAP_MS ? [interval] : [];
  }).sort((a, b) => a - b);
  const cadence = intervals[Math.floor(intervals.length / 2)] ?? 50;
  return Math.min(MAX_TRACKING_GAP_MS, Math.max(240, cadence * 2.5));
}

/** Keep the newest uninterrupted observation, recovering after a real pause.
 * Missing current tracking never revives a sign from earlier frames.
 */
export function recentContinuousFrames<T extends Timed>(
  frames: readonly T[], duration: number, tracked?: (frame: T) => boolean,
): T[] {
  const end = frames.at(-1);
  if (!end || !Number.isFinite(end.timestamp) || (tracked && !tracked(end))) return [];
  const recent = frames.filter(frame => end.timestamp - frame.timestamp <= duration);
  const gapLimit = trackingGapLimit(recent);
  let start = recent.length - 1;
  let lastTracked = end.timestamp;
  for (let index = start - 1; index >= 0; index--) {
    const frame = recent[index];
    const gap = recent[index + 1].timestamp - frame.timestamp;
    if (!Number.isFinite(gap) || gap <= 0 || gap > gapLimit
      || (tracked && lastTracked - frame.timestamp > gapLimit)) break;
    if (!tracked || tracked(frame)) lastTracked = frame.timestamp;
    start = index;
  }
  while (tracked && start < recent.length - 1 && !tracked(recent[start])) start++;
  return recent.slice(start);
}

/** Minimum time between two analysed camera frames. The intent has always been
 * 20 analysed frames per second, the cadence of every recorded evaluation.
 * A threshold of exactly 50 ms does not deliver that: display callbacks arrive
 * every 16.7 ms, the third one lands a hair before or after 50 ms, and when it
 * lands before, the frame waits for the fourth. Measured with a 30 fps camera
 * on a 60 Hz display: 50 ms gives about 17 per second with 66 ms gaps; 45 ms
 * gives 20 per second with 50 ms gaps
 * (docs/evaluation/recognition-sprint-2026-11-16-frame-gate.jsonl). */
export const MIN_ANALYSIS_INTERVAL_MS = 45;

/** The camera loop's gate: enough time has passed and the video shows a frame
 * that has not been analysed yet. */
export function shouldAnalyseFrame(now: number, lastAnalysedAt: number, videoTime: number, lastVideoTime: number,
  minInterval = MIN_ANALYSIS_INTERVAL_MS) {
  return now - lastAnalysedAt >= minInterval && videoTime !== lastVideoTime;
}
