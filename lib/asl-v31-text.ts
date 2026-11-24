/**
 * How a model gloss is shown in the transcript.
 *
 * PopSign records some signs as one label for what English splits into several words - the same
 * pointing-at-yourself sign is "mine", "my" and "me" - so the raw label reads as "Minemy" in the
 * transcript, which looks like a fault even when recognition was right. These are the labels where the
 * joined form is not a single concept (BATHROOM and COWBOY are compounds and stay as they are).
 */
const DISPLAY: Record<string, string> = {
  MINEMY: "Me",
  WEUS: "We",
  HESHEIT: "He/She",
  NIGHTNIGHT: "Night",
  ALLGONE: "All gone",
  SOBIG: "So big",
  HAVETO: "Have to",
};

/** What to put in the transcript for a gloss: a readable phrase, never a joined label. */
export function displayTextForGloss(gloss: string): string {
  const key = gloss.trim().toUpperCase();
  const mapped = DISPLAY[key];
  if (mapped) return mapped;
  return key.replace(/-/g, " ").toLowerCase().replace(/\b\w/g, letter => letter.toUpperCase());
}

/** Words the model has no class for, so recognition can never produce them however clearly they are signed. */
export const ABSENT_FROM_MODEL = ["YOU", "HAPPY"] as const;
