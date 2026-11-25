/**
 * How a model gloss is shown in the transcript.
 *
 * PopSign records some signs as one label for what English splits into several words - the same
 * pointing-at-yourself sign is "mine", "my" and "me" - so the raw label reads as "Minemy" in the
 * transcript, which looks like a fault even when recognition was right. These are the labels where the
 * joined form is not a single concept (BATHROOM and COWBOY are compounds and stay as they are).
 */
const DISPLAY: Record<string, string> = {
  CALLONPHONE: "Call on phone",
  TURNONLIGHT: "Turn on light",
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

import MODEL_CLASSES from "../public/models/asl-v31/classes.json";

/** Words the model has no class for, so recognition can never produce them however clearly they are signed. */
export const ABSENT_FROM_MODEL = ["YOU", "HAPPY"] as const;

/** Whether the shipped model can recognise this gloss at all. */
export function isModelClass(gloss: string): boolean {
  return (MODEL_CLASSES as readonly string[]).includes(gloss.trim().toUpperCase());
}

/**
 * Everyday words worth teaching that the model has no class for, so a new signer is pointed at the
 * gaps first instead of discovering them one failed sign at a time. The list is a judgement call kept
 * deliberately short; words the model already has are excluded by checking the class list.
 */
const EVERYDAY_FIRST = ["YOU", "HAPPY", "HUNGRY", "SORRY", "LEARN", "FAMILY", "MOTHER", "FATHER", "BUSY", "READY",
  "TIRED", "NAME", "PLAY", "DRINK", "SLEEP", "TODAY", "TOMORROW"];

export function teachFirstSuggestions(): string[] {
  return EVERYDAY_FIRST.filter(word => !isModelClass(word));
}
