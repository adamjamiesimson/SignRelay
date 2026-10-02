export type MotionReason = "hands" | "moving" | "idle" | "ready";

/**
 * Prevent one physical sign episode from emitting multiple transcript words.
 *
 * After a confirmation, recognition stays locked until the stream has spent a
 * short continuous period with no completed movement ("idle" or hands absent).
 * Any renewed movement resets that quiet-period timer. This is intentionally
 * independent of model confidence: a second high-confidence class from the
 * tail of the same movement is still an extra prediction, not a new sign.
 */
export class InterSignGate {
  private locked = false;
  private quietSince: number | null = null;

  constructor(private readonly quietPeriodMs = 260) {
    if (!Number.isFinite(quietPeriodMs) || quietPeriodMs < 0) {
      throw new Error("quietPeriodMs must be a finite non-negative number");
    }
  }

  reset() {
    this.locked = false;
    this.quietSince = null;
  }

  lock() {
    this.locked = true;
    this.quietSince = null;
  }

  update(now: number, reason: MotionReason) {
    if (!this.locked) return true;
    if (!Number.isFinite(now)) return false;

    if (reason === "idle" || reason === "hands") {
      this.quietSince ??= now;
      if (now - this.quietSince >= this.quietPeriodMs) {
        this.locked = false;
        this.quietSince = null;
        return true;
      }
    } else {
      this.quietSince = null;
    }
    return false;
  }

  get armed() {
    return !this.locked;
  }
}
