import { distance2, handScale, validHand } from "./asl-starter-recognition";
import type { VisionFrame } from "./vision-types";

export type AslMotionSegment = { frames: VisionFrame[]; boundary: "rest" | "departure"; observedAt: number };

const MAX_GAP_MS = 210;
const LEAD_MS = 150;
const REST_MS = 220;
const DEPARTURE_MS = 280;
const MAX_SEGMENT_MS = 3500;
const MIN_SEGMENT_MS = 200;
const ACTIVE_SPEED = 1; // palm lengths per second, over actual timestamp interval
const ACTIVE_SAMPLES = 2;

function tracked(frame: VisionFrame) {
  return frame.hands.filter(hand => validHand(hand) && hand.landmarks[0].x >= 0 && hand.landmarks[0].x <= 1
    && hand.landmarks[0].y >= 0 && hand.landmarks[0].y <= 1);
}

function motionSpeed(previous: VisionFrame, current: VisionFrame, elapsed: number) {
  const prior = tracked(previous);
  return Math.max(0, ...tracked(current).map(hand => {
    const match = prior.find(item => item.handedness === hand.handedness);
    if (!match) return 0;
    const scale = (handScale(hand) + handScale(match)) / 2;
    const palm = distance2(hand.landmarks[0], match.landmarks[0]);
    const fingers = [4, 8, 12, 20].reduce((sum, index) => sum + distance2(hand.landmarks[index], match.landmarks[index]), 0) / 4;
    return (palm + fingers) * 500 / (scale * elapsed);
  }));
}

/** Proposes a bounded segment using only observed movement and a subsequent
 * rest or sustained departure. Its output still needs a sign classifier. */
export class AslMotionSpotter {
  private frames: VisionFrame[] = [];
  private previous: VisionFrame | undefined;
  private activeSince: number | null = null;
  private activeSamples = 0;
  private lastMotion = 0;
  private lastHand: number | null = null;

  reset() {
    this.frames = [];
    this.previous = undefined;
    this.activeSince = null;
    this.activeSamples = 0;
    this.lastMotion = 0;
    this.lastHand = null;
  }

  push(frame: VisionFrame): AslMotionSegment | null {
    const now = frame.timestamp;
    if (!Number.isFinite(now)) { this.reset(); return null; }
    const elapsed = now - (this.previous?.timestamp ?? now);
    if (elapsed <= 0 || elapsed > MAX_GAP_MS) this.reset();
    const hasHand = tracked(frame).length > 0;
    const moving = this.previous && hasHand && motionSpeed(this.previous, frame, elapsed) >= ACTIVE_SPEED;
    this.previous = frame;
    if (hasHand) this.lastHand = now;
    if (moving) {
      this.activeSince ??= now;
      this.lastMotion = now;
      this.activeSamples++;
    }
    this.frames.push(frame);
    const cutoff = (this.activeSince ?? now) - LEAD_MS;
    while (this.frames[0].timestamp < cutoff) this.frames.shift();
    if (this.activeSince === null) return null;
    if (now - this.activeSince > MAX_SEGMENT_MS || this.frames.length > 110) {
      this.reset();
      return null;
    }
    const end = this.lastHand ?? now;
    const boundary = hasHand ? (now - this.lastMotion >= REST_MS ? "rest" : null)
      : now - end >= DEPARTURE_MS ? "departure" : null;
    if (!boundary) return null;
    const completed = this.activeSamples >= ACTIVE_SAMPLES && this.lastMotion - this.activeSince >= MIN_SEGMENT_MS;
    const frames = this.frames.filter(sample => sample.timestamp <= end);
    this.reset();
    return completed ? { frames, boundary, observedAt: now } : null;
  }
}
