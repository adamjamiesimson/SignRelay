/**
 * Limit recognition to new video-frame notifications. requestVideoFrameCallback's
 * presentedFrames counter is the preferred browser identity, rather than the
 * video element's playback clock (which may advance while displaying repeats).
 *
 * This is not a pixel-level deduplicator: a browser can present duplicate
 * image content as distinct frames, especially from a synthetic MediaStream.
 */
export class VideoFrameGate {
  private latestPresented = -1;
  private consumedPresented = -1;
  private fallbackMediaTime = -1;
  private lastProcessedAt = -Infinity;

  observePresented(presentedFrames: number): boolean {
    if (!Number.isSafeInteger(presentedFrames) || presentedFrames < 0
      || presentedFrames <= this.latestPresented) return false;
    this.latestPresented = presentedFrames;
    return true;
  }

  takePresented(now: number, minimumIntervalMs = 50): boolean {
    if (!Number.isFinite(now) || now - this.lastProcessedAt < minimumIntervalMs
      || this.latestPresented <= this.consumedPresented) return false;
    this.consumedPresented = this.latestPresented;
    this.lastProcessedAt = now;
    return true;
  }

  /** Best-effort fallback for browsers without requestVideoFrameCallback. */
  takeFallback(mediaTime: number, now: number, minimumIntervalMs = 50): boolean {
    if (!Number.isFinite(mediaTime) || mediaTime < 0 || !Number.isFinite(now)
      || now - this.lastProcessedAt < minimumIntervalMs
      || mediaTime === this.fallbackMediaTime) return false;
    this.fallbackMediaTime = mediaTime;
    this.lastProcessedAt = now;
    return true;
  }

  reset(): void {
    this.latestPresented = -1;
    this.consumedPresented = -1;
    this.fallbackMediaTime = -1;
    this.lastProcessedAt = -Infinity;
  }
}
