import type { VisionFrame } from "./vision-types";

/** Automated software rehearsal (rehearsal build profile only). A script plays
 * synthetic hand landmarks in place of the tracker's output while the real
 * camera, frame loop, recognition worker and transcript run unchanged. It is
 * labelled on every page and is never part of the demo or the public site. */
// Compare the inlined variable here instead of importing BUILD_PROFILE: once
// build-profile is shared between page chunks it is no longer constant-folded,
// and the hook must be removed from every other build, not merely disabled
// (scripts/verify-runtime.mjs checks that it is absent).
export const REHEARSAL = process.env.NEXT_PUBLIC_SIGNRELAY_PROFILE === "rehearsal";
export const REHEARSAL_BANNER = "AUTOMATED SOFTWARE REHEARSAL: synthetic hand landmarks, not a person signing. This is not a recognition accuracy test.";

export class RehearsalScript {
  private frames: VisionFrame[] = [];
  private startedAt: number | null = null;
  private index = 0;
  /** Queue a scripted sequence; timestamps are relative and replayed against the live frame loop's clock. */
  play(frames: VisionFrame[]) {
    const origin = frames[0]?.timestamp ?? 0;
    this.frames = frames.map(frame => ({ ...frame, timestamp: frame.timestamp - origin }));
    this.startedAt = null;
    this.index = 0;
  }
  get playing() { return this.index < this.frames.length; }
  /** The latest scripted frame due at `now`, stamped with `now`; the previous
   * frame is held if the next one is not due yet. Null when nothing is scripted. */
  next(now: number): VisionFrame | null {
    if (!this.playing) return null;
    this.startedAt ??= now;
    const elapsed = now - this.startedAt;
    while (this.index < this.frames.length && this.frames[this.index].timestamp <= elapsed) this.index++;
    const frame = this.frames[Math.max(0, this.index - 1)];
    return { ...frame, timestamp: now };
  }
}
