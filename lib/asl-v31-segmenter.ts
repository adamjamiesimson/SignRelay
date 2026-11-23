import { hasHand, N_POINTS, resampleTo15Hz, signingEvidence } from "../engine-v3/web/preprocess.mjs";

type Sample = { t: number; f: Float32Array };
type OpenSegment = { start: number; lastHand: number };
type Segmentation = { reason: "hands" | "idle" | "moving" | "ready"; clip?: Float32Array[] };

// These timings come from Engine V3.1's evaluated camera segmenter. The
// model itself then trims and pads the selected window as it did in training.
const HAND_GAP_MS = 500;
const MAX_SEGMENT_MS = 4000;
const MARGIN_MS = 600;
const MIN_OBSERVED_HAND_FRAMES = 3;
const MAX_SAMPLES = 192;

// When the shoulders are out of frame (a close-up webcam crop is the common case) the
// signing-space rule cannot tell a sign from a hand resting in view. Without it the only
// boundary left was "the hand left the picture", so the first sign ran to the 4 s cap and the
// segmenter then waited for a rest that a visible hand could never give: recognition stopped.
// In that case a hand counts as signing while it is actually moving (or within MOTION_HOLD_MS
// of its last movement), so a finished sign ends and the next one can start.
const MOTION_WINDOW_MS = 250;
const MOTION_HOLD_MS = 600;
const MOTION_EPSILON = 0.012;
// Pose landmarks 11 and 12 in the 86-point layout: the shoulders `signingEvidence` uses.
const SHOULDER_SLOTS = [42 + 7, 42 + 8];

/** Shoulder points are written all-or-nothing, so x/y both being finite means the rule can run. */
export function shouldersVisible(features: Float32Array) {
  return SHOULDER_SLOTS.every(slot => Number.isFinite(features[slot * 3]) && Number.isFinite(features[slot * 3 + 1]));
}

export type AslV31SegmenterOptions = {
  /**
   * End a sign when hands are absent *or resting below signing space* (the same shoulder-based
   * rule that opens a segment) for HAND_GAP_MS. Default true. Without it, hands resting visibly
   * in frame hold a segment open to the 4 s cap and then block recognition until they leave the
   * frame. Identical results on all sprint replays, where signers lower their hands out of view;
   * the in-view resting case is not yet measured on a physical camera. `false` is the PR #67
   * behaviour, kept for offline comparisons.
   */
  restAware?: boolean;
};

export class AslV31Segmenter {
  private samples: Sample[] = [];
  private active: OpenSegment | null = null;
  private waitingForRestSince: number | null = null;
  private lastMotionAt = -Infinity;
  private readonly restAware: boolean;
  /** Session counters for developer diagnostics; reset() keeps them, resetStats() clears them. */
  readonly stats = { opened: 0, completed: 0, capped: 0, tooFewHands: 0 };

  resetStats() {
    Object.assign(this.stats, { opened: 0, completed: 0, capped: 0, tooFewHands: 0 });
  }

  constructor(options: AslV31SegmenterOptions = {}) {
    this.restAware = options.restAware ?? true;
  }

  reset() {
    this.samples = [];
    this.active = null;
    this.waitingForRestSince = null;
    this.lastMotionAt = -Infinity;
  }

  /** Largest hand-point travel over the last MOTION_WINDOW_MS. Points missing in either frame
   * are skipped, so a partly tracked hand still reports the movement it does show. */
  private travel(timestamp: number, features: Float32Array) {
    const reference = this.samples.find(sample => sample.t >= timestamp - MOTION_WINDOW_MS);
    if (!reference) return 0;
    let travel = 0;
    for (let point = 0; point < 42; point++) {
      const offset = point * 3;
      if (!Number.isFinite(features[offset]) || !Number.isFinite(features[offset + 1])
        || !Number.isFinite(reference.f[offset]) || !Number.isFinite(reference.f[offset + 1])) continue;
      const distance = Math.hypot(features[offset] - reference.f[offset], features[offset + 1] - reference.f[offset + 1]);
      if (distance > travel) travel = distance;
    }
    return travel;
  }

  /** Whether this frame shows a hand that is signing: inside signing space whenever the
   * shoulders allow that test, and otherwise only while the hand is moving. */
  private isSigning(timestamp: number, features: Float32Array) {
    if (!hasHand(features)) return false;
    if (!this.restAware) return true;
    if (shouldersVisible(features)) return signingEvidence(features);
    return timestamp - this.lastMotionAt <= MOTION_HOLD_MS;
  }

  suppressCurrentSegment() {
    const last = this.samples.at(-1);
    // The same rule that ends a sign decides whether a rest is still owed, so a personal
    // confirmation does not demand that the hand leave the picture.
    const stillSigning = last ? this.isSigning(last.t, last.f) : false;
    this.reset();
    if (last && stillSigning) this.waitingForRestSince = last.t;
  }

  observe(timestamp: number, features: Float32Array | undefined): Segmentation {
    if (!Number.isFinite(timestamp) || features?.length !== N_POINTS * 3) {
      this.reset();
      return { reason: "hands" };
    }
    const previous = this.samples.at(-1);
    if (previous && timestamp <= previous.t) this.reset();

    const anyHand = hasHand(features);
    // Movement is measured against frames already observed, so it runs before this one is stored.
    if (anyHand && this.restAware && !shouldersVisible(features)
      && this.travel(timestamp, features) >= MOTION_EPSILON) this.lastMotionAt = timestamp;
    // Signing continues while a hand is in signing space, or - without shoulders - while it moves.
    const signing = this.isSigning(timestamp, features);
    if (this.waitingForRestSince !== null) {
      if (signing) this.waitingForRestSince = timestamp;
      if (timestamp - this.waitingForRestSince <= HAND_GAP_MS) return { reason: anyHand ? "idle" : "hands" };
      this.waitingForRestSince = null;
    }

    this.samples.push({ t: timestamp, f: features });
    while (this.samples.length > MAX_SAMPLES || this.samples[0].t < timestamp - MAX_SEGMENT_MS - MARGIN_MS * 2) {
      this.samples.shift();
    }
    if (!this.active && (this.restAware ? signing : signingEvidence(features))) {
      // The legacy path (restAware: false) opens on signing space and continues on any visible
      // hand, exactly as PR #67 did; the rest-aware path uses one rule for both.
      this.active = { start: timestamp, lastHand: timestamp };
      this.stats.opened++;
    }
    if (!this.active) return { reason: anyHand ? "idle" : "hands" };
    if (signing) this.active.lastHand = timestamp;

    const { start, lastHand } = this.active;
    const ended = !signing && timestamp - lastHand > HAND_GAP_MS;
    const reachedLimit = timestamp - start > MAX_SEGMENT_MS;
    if (!ended && !reachedLimit) return { reason: "moving" };

    this.active = null;
    if (!ended) {
      this.waitingForRestSince = lastHand;
      this.stats.capped++;
    }
    const end = Math.min(timestamp, lastHand + MARGIN_MS);
    const segment = this.samples.filter(sample => sample.t >= start - MARGIN_MS && sample.t <= end);
    // A capped or already-processed movement cannot reopen on its old samples.
    // Keep only preceding rest after its last observed hand for the next sign.
    this.samples = this.samples.filter(sample => sample.t > lastHand);
    if (segment.filter(sample => hasHand(sample.f)).length < MIN_OBSERVED_HAND_FRAMES) {
      this.stats.tooFewHands++;
      return { reason: "hands" };
    }
    this.stats.completed++;
    return { reason: "ready", clip: resampleTo15Hz(segment) };
  }
}
