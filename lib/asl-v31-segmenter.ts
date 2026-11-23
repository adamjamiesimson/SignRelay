import { hasHand, N_POINTS, resampleTo15Hz, signingEvidence } from "../engine-v3/web/preprocess.mjs";

type Sample = { t: number; f: Float32Array };
type OpenSegment = { start: number; lastHand: number };
type Segmentation = { reason: "hands" | "idle" | "moving" | "ready"; clip?: Float32Array[] };

// These timings come from Engine V3.1's evaluated camera segmenter. The
// model itself then trims and pads the selected window as it did in training.
const HAND_GAP_MS = 500;
// A single sign is one to two seconds. The 4 s cap let a hand that kept moving after the sign stay in
// the window, and the extra second cost recognition outright: the captured HIGH scored 0.809 (rejected)
// over its 4 s cap and 0.987 (accepted) over its first 2.5 s.
const MAX_SEGMENT_MS = 2500;
const MARGIN_MS = 600;
const MIN_OBSERVED_HAND_FRAMES = 3;
const MAX_SAMPLES = 192;

// The signing-space rule alone cannot tell a sign from a hand resting inside it. On a physical
// desk camera both wrists sat inside signing space in every single frame (61/61, 218/218), so
// every sign ran to the 4 s cap and the segmenter then waited for a rest that never came: only
// the first sign of a session was ever recognised. Signing is therefore measured by movement - a
// hand counts as signing while it moves, or within MOTION_HOLD_MS of its last movement - so a
// finished sign ends with its hold included and the next sign can start. Signing space still
// gates where a sign may begin when the shoulders are visible, which keeps fidgeting out.
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
   * End a sign when the hand stops moving for HAND_GAP_MS, instead of waiting for it to leave
   * signing space. Default true. A hand that rests visibly in frame - the normal case at a desk -
   * otherwise holds a segment open to the 4 s cap and then blocks recognition until it leaves the
   * picture, so only the first sign of a session was recognised. `false` is the PR #67 behaviour,
   * kept for offline comparisons.
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

  /** Whether this frame continues a sign: a hand is present and it moved recently. Position is
   * deliberately not part of this test - see the note on MOTION_WINDOW_MS. */
  private isSigning(timestamp: number, features: Float32Array) {
    if (!hasHand(features)) return false;
    if (!this.restAware) return true;
    return timestamp - this.lastMotionAt <= MOTION_HOLD_MS;
  }

  /** Where a sign may start: in signing space when the shoulders are visible, anywhere without
   * them. The first moving frame opens the segment, so the hand's travel into the sign is part of
   * the clip, and a hand that is merely resting never opens one. */
  private canOpen(features: Float32Array, signing: boolean) {
    if (!this.restAware) return signingEvidence(features);
    return signing && (!shouldersVisible(features) || signingEvidence(features));
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
    // A hand appearing where none was tracked counts as movement: the hand entered the picture.
    const appeared = anyHand && !!previous && !hasHand(previous.f);
    const moving = anyHand && this.restAware
      && (appeared || this.travel(timestamp, features) >= MOTION_EPSILON);
    if (moving) this.lastMotionAt = timestamp;
    // Signing continues while the hand keeps moving, or within MOTION_HOLD_MS of its last movement.
    const signing = this.isSigning(timestamp, features);
    // Recorded before the rest wait returns, because travel is measured against these samples:
    // skipping them left the wait with no reference and it could clear while the hand still moved.
    this.samples.push({ t: timestamp, f: features });
    while (this.samples.length > MAX_SAMPLES || this.samples[0].t < timestamp - MAX_SEGMENT_MS - MARGIN_MS * 2) {
      this.samples.shift();
    }
    if (this.waitingForRestSince !== null) {
      // The wait ends once a rest has lasted HAND_GAP_MS, and the frame that ends it may already be
      // moving again - otherwise a sign started right after a capped one was never recognised.
      if (timestamp - this.waitingForRestSince > HAND_GAP_MS) this.waitingForRestSince = null;
      else {
        if (signing) this.waitingForRestSince = timestamp;
        return { reason: anyHand ? "idle" : "hands" };
      }
    }

    if (!this.active && this.canOpen(features, signing)) {
      // The legacy path (restAware: false) opens on signing space and continues on any visible
      // hand, exactly as PR #67 did; the rest-aware path opens on movement inside signing space
      // and continues on movement alone.
      this.active = { start: timestamp, lastHand: timestamp };
      this.stats.opened++;
    }
    if (!this.active) return { reason: anyHand ? "idle" : "hands" };
    // The clip ends MARGIN_MS after the last frame with a hand in it, so a sign keeps the hold at
    // its end and a dropped tracking frame in the middle does not split it.
    if (signing || anyHand) this.active.lastHand = timestamp;

    const { start, lastHand } = this.active;
    // A hand that is visible but no longer moving has finished signing (MOTION_HOLD_MS already
    // covers the hold), while a hand that vanished may simply have been dropped for a frame, so
    // that only ends the segment once it has been gone for HAND_GAP_MS.
    const ended = !signing && (anyHand || timestamp - lastHand > HAND_GAP_MS);
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
