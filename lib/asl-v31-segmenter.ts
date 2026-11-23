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
  private readonly restAware: boolean;

  constructor(options: AslV31SegmenterOptions = {}) {
    this.restAware = options.restAware ?? true;
  }

  reset() {
    this.samples = [];
    this.active = null;
    this.waitingForRestSince = null;
  }

  suppressCurrentSegment() {
    const last = this.samples.at(-1);
    const stillVisible = last && hasHand(last.f);
    this.reset();
    if (stillVisible) this.waitingForRestSince = last.t;
  }

  observe(timestamp: number, features: Float32Array | undefined): Segmentation {
    if (!Number.isFinite(timestamp) || features?.length !== N_POINTS * 3) {
      this.reset();
      return { reason: "hands" };
    }
    const previous = this.samples.at(-1);
    if (previous && timestamp <= previous.t) this.reset();

    const anyHand = hasHand(features);
    // Signing continues while a hand is visible, or (rest-aware) while one is in signing space.
    const signing = this.restAware ? signingEvidence(features) : anyHand;
    if (this.waitingForRestSince !== null) {
      if (signing) this.waitingForRestSince = timestamp;
      if (timestamp - this.waitingForRestSince <= HAND_GAP_MS) return { reason: anyHand ? "idle" : "hands" };
      this.waitingForRestSince = null;
    }

    this.samples.push({ t: timestamp, f: features });
    while (this.samples.length > MAX_SAMPLES || this.samples[0].t < timestamp - MAX_SEGMENT_MS - MARGIN_MS * 2) {
      this.samples.shift();
    }
    if (!this.active && signingEvidence(features)) this.active = { start: timestamp, lastHand: timestamp };
    if (!this.active) return { reason: anyHand ? "idle" : "hands" };
    if (signing) this.active.lastHand = timestamp;

    const { start, lastHand } = this.active;
    const ended = !signing && timestamp - lastHand > HAND_GAP_MS;
    const reachedLimit = timestamp - start > MAX_SEGMENT_MS;
    if (!ended && !reachedLimit) return { reason: "moving" };

    this.active = null;
    if (!ended) this.waitingForRestSince = lastHand;
    const end = Math.min(timestamp, lastHand + MARGIN_MS);
    const segment = this.samples.filter(sample => sample.t >= start - MARGIN_MS && sample.t <= end);
    // A capped or already-processed movement cannot reopen on its old samples.
    // Keep only preceding rest after its last observed hand for the next sign.
    this.samples = this.samples.filter(sample => sample.t > lastHand);
    if (segment.filter(sample => hasHand(sample.f)).length < MIN_OBSERVED_HAND_FRAMES) return { reason: "hands" };
    return { reason: "ready", clip: resampleTo15Hz(segment) };
  }
}
