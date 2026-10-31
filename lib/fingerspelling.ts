/** Alphabet IDs are not recognition coverage. See the measured sequence pilot report. */
export const ASL_ALPHABET = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"] as readonly string[];
export type Letter = string;
export const FINGERSPELLING_MODEL = Object.freeze({
  status: "experimental-sequence" as const,
  supportedLetters: Object.freeze([] as string[]),
  reason: "Experimental sequence recognition: review and confirm every candidate. Complete A–Z reliability is not established.",
});

export function letterAt(index: number, labels: readonly string[]): string | null {
  if (!Number.isInteger(index) || index < 0 || index >= labels.length) return null;
  const label = labels[index];
  return ASL_ALPHABET.includes(label) && label.length === 1 ? label : null;
}

export type LetterEvidence = {
  letter: string;
  score: number;
  time: number;
  hand: "Left" | "Right";
  /** J/Z require evidence from a sequence model, never a still handshape. */
  motionComplete: boolean;
};
export type ConfirmationPolicy = {
  minScore: number; dwellMs: number; minSamples: number; maxGapMs: number; maxAgeMs: number;
};

/** Deliberate commit only. Policy must come from held-out calibration before
 * deployment; test policies are software fixtures, not measured calibration.
 * This controller is NOT a classifier and is not enabled with a missing model.
 */
export class LetterConfirmation {
  private first = 0;
  private last = -Infinity;
  private samples = 0;
  private evidence: LetterEvidence | null = null;
  constructor(private policy: ConfirmationPolicy, private supported: readonly string[]) {
    if (!Object.values(policy).every(Number.isFinite) || policy.minScore < 0 || policy.minScore > 1
      || policy.dwellMs <= 0 || policy.minSamples < 2 || !Number.isInteger(policy.minSamples)
      || policy.maxGapMs <= 0 || policy.maxAgeMs <= 0) throw new Error("Invalid confirmation policy");
  }
  reset() { this.first = 0; this.last = -Infinity; this.samples = 0; this.evidence = null; }
  observe(value: LetterEvidence | null) {
    if (!value || !ASL_ALPHABET.includes(value.letter) || value.letter.length !== 1
      || !this.supported.includes(value.letter) || !Number.isFinite(value.score)
      || value.score < this.policy.minScore || value.score > 1 || !Number.isFinite(value.time)
      || !["Left", "Right"].includes(value.hand)
      || (["J", "Z"].includes(value.letter) && !value.motionComplete)) { this.reset(); return; }
    if (value.time <= this.last) { this.reset(); return; }
    if (!this.evidence || this.evidence.letter !== value.letter || this.evidence.hand !== value.hand
      || value.time - this.last > this.policy.maxGapMs) {
      this.first = value.time; this.samples = 0;
    }
    this.evidence = { ...value }; this.last = value.time; this.samples++;
  }
  candidate(now: number): string | null {
    if (!Number.isFinite(now) || now < this.last || now - this.last > this.policy.maxAgeMs) return null;
    return this.evidence?.letter ?? null;
  }
  ready(now: number) {
    return !!this.candidate(now) && this.samples >= this.policy.minSamples
      && this.last - this.first >= this.policy.dwellMs;
  }
  /** Consumes evidence. Two deliberate commits can enter LL; a held hand alone
   * never appends anything. Every commit needs a fresh dwell and fresh samples. */
  commit(now: number): string | null {
    if (!this.ready(now)) return null;
    const letter = this.evidence!.letter; this.reset(); return letter;
  }
}

export const MAX_FINGERSPELLING_TEXT = 2000;
export function editSpelling(text: string, action: "backspace" | "space" | "clear") {
  if (action === "clear") return "";
  if (action === "backspace") return Array.from(text).slice(0, -1).join("");
  return (text + " ").slice(0, MAX_FINGERSPELLING_TEXT);
}
