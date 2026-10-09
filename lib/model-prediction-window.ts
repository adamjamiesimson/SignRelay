/**
 * A completed sign can temporarily switch to "moving"/"idle" during slower
 * asynchronous research-model inference. Permit a very short grace period
 * without accepting results while motion is unready.
 *
 * Missing hands or a long delay always invalidate pending model evidence.
 */
export function retainAslPredictionAcrossMotionGap(
  reason: "hands" | "moving" | "idle" | "ready",
  elapsedSinceReadyMs: number,
  graceMs = 450,
): boolean {
  return reason !== "hands" && reason !== "ready"
    && Number.isFinite(elapsedSinceReadyMs)
    && elapsedSinceReadyMs >= 0
    && elapsedSinceReadyMs <= graceMs;
}
