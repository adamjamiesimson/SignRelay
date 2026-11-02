/**
 * Decoded pixels and their own media timestamp, taken together.
 *
 * requestVideoFrameCallback metadata and `video.currentTime` describe the
 * frame the compositor presented. A drawImage/createImageBitmap/VideoFrame
 * read of the element can already return a newer camera frame: in headless
 * Chromium with a 30-fps fake camera, callback metadata did not describe the
 * element's current frame in 1–27 % of callbacks, and the production
 * fingerspelling snapshot paired pixels with the previous frame's timestamp
 * in up to 6 % of tracked frames (docs/engineering-sprint-2026-11-03).
 *
 * A WebCodecs VideoFrame is immutable and carries its own timestamp, so the
 * pixels handed to tracking and the time attached to them cannot disagree.
 * When WebCodecs is missing, construction fails, or its timestamps prove
 * unusable, `take` returns null and callers keep their previous behaviour.
 */
export type OwnedFrame = { frame: VideoFrame; mediaMs: number; repeat: boolean };

/** Consecutive non-advancing timestamps (while the caller saw the source
 * advance) before WebCodecs timing is considered unusable for this source. */
export const STALLED_TIMESTAMP_LIMIT = 8;

export class OwnFrameSource {
  private enabled = typeof VideoFrame === "function";
  private lastMediaMs = -Infinity;
  private stalled = 0;
  disabledReason: string | null = null;
  get available() { return this.enabled; }

  /**
   * @param advanced whether the caller's own signal (callback metadata or
   * currentTime) indicates a new frame. A repeated timestamp despite that
   * signal is normal occasionally, but never indefinitely.
   */
  take(source: HTMLVideoElement, advanced: boolean): OwnedFrame | null {
    if (!this.enabled) return null;
    let frame: VideoFrame;
    try { frame = new VideoFrame(source); }
    catch (error) { this.disable(`VideoFrame unavailable: ${error instanceof Error ? error.message : String(error)}`); return null; }
    const mediaMs = frame.timestamp / 1000;
    if (!Number.isFinite(mediaMs)) { frame.close(); this.disable("VideoFrame timestamp is not finite"); return null; }
    const repeat = mediaMs === this.lastMediaMs;
    if (repeat && advanced) {
      if (++this.stalled >= STALLED_TIMESTAMP_LIMIT) { frame.close(); this.disable("VideoFrame timestamps do not advance"); return null; }
    } else if (!repeat) { this.stalled = 0; this.lastMediaMs = mediaMs; }
    return { frame, mediaMs, repeat };
  }

  private disable(reason: string) { this.enabled = false; this.disabledReason = reason; }
}

/**
 * Maps a source's media clock onto one strictly increasing tracking clock.
 * The first frame anchors the media clock to `anchor` (a performance-clock
 * time); intervals between frames are then the camera's own intervals rather
 * than whenever the tracking lane happened to become free. A backwards media
 * time (a new stream) re-anchors so tracking timestamps still increase.
 */
export class MediaTrackingClock {
  private offset: number | null = null;
  private last = -Infinity;
  reanchored = 0;
  map(mediaMs: number, anchor: number) {
    let timestamp = this.offset === null ? NaN : mediaMs + this.offset;
    if (!(timestamp > this.last)) {
      if (this.offset !== null) this.reanchored++;
      this.offset = Math.max(anchor, this.last + 1) - mediaMs;
      timestamp = mediaMs + this.offset;
    }
    this.last = timestamp;
    return timestamp;
  }
}
