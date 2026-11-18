import { BUILD_PROFILE } from "./build-profile";
import type { VisionFrame } from "./vision-types";

/** Automated software rehearsal (rehearsal build profile only). A script supplies
 * timestamped synthetic landmarks to the same recognition worker and transcript. It is
 * labelled on every page and is never part of the demo or the public site. */
export const REHEARSAL = BUILD_PROFILE === "rehearsal";
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
  cancel() {
    this.frames = [];
    this.index = 0;
    this.startedAt = null;
  }
  get playing() { return this.index < this.frames.length; }
  /** Drain up to eight due observations per callback, in source order. Browser
   * callback delays change delivery time while the recording's cadence stays fixed. */
  takeDue(now: number, limit = 8): VisionFrame[] {
    if (!this.playing) return [];
    this.startedAt ??= now;
    const origin = this.startedAt;
    const due: VisionFrame[] = [];
    while (this.playing && due.length < limit && this.frames[this.index].timestamp <= now - origin) {
      const frame = this.frames[this.index++];
      due.push({ ...frame, timestamp: origin + frame.timestamp });
    }
    return due;
  }
}
