type Timed = { timestamp: number };

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

// Leave room for display callback jitter. On a 60 Hz display a frame just
// before the nominal 50 ms boundary can otherwise fall through to 66 ms.
export function shouldAnalyseFrame(now: number, lastAnalysedAt: number, videoTime: number, lastVideoTime: number,
  minIntervalMs = 45) {
  return now - lastAnalysedAt >= minIntervalMs && videoTime !== lastVideoTime;
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
