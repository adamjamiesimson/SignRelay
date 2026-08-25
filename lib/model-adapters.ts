import WLASL1000_LABELS from "../public/models/asl1000-tgcn/labels.json";

export type LanguageId = "asl" | "isl" | "csl";

export type ModelAdapter = {
  id: LanguageId;
  shortName: string;
  language: string;
  status: "experimental" | "not-installed";
  modelFile: string | null;
  vocabulary: string[];
  inputFormat: string;
  sequenceLength: number;
  confidenceThreshold: number;
  decoder: string;
  postProcessing: string;
  version: string;
  dataset: string;
  summary: string;
};

export type AslVocabularyEntry = {
  gloss: string;
  text: string;
  category: "conversation" | "actions" | "food" | "feelings" | "people" | "places" | "learning" | "questions" | "time" | "safety" | "custom";
  recognition: "built-in" | "personal-calibration";
};

export const WLASL100_GLOSSES = [
  "BOOK", "DRINK", "COMPUTER", "BEFORE", "CHAIR", "GO", "CLOTHES", "WHO", "CANDY", "COUSIN", "DEAF", "FINE", "HELP", "NO", "THIN", "WALK", "YEAR", "YES", "ALL", "BLACK", "COOL", "FINISH", "HOT", "LIKE", "MANY", "MOTHER", "NOW", "ORANGE", "TABLE", "THANKSGIVING", "WHAT", "WOMAN", "BED", "BLUE", "BOWLING", "CAN", "DOG", "FAMILY", "FISH", "GRADUATE", "HAT", "HEARING", "KISS", "LANGUAGE", "LATER", "MAN", "SHIRT", "STUDY", "TALL", "WHITE", "WRONG", "ACCIDENT", "APPLE", "BIRD", "CHANGE", "COLOR", "CORN", "COW", "DANCE", "DARK", "DOCTOR", "EAT", "ENJOY", "FORGET", "GIVE", "LAST", "MEET", "PINK", "PIZZA", "PLAY", "SCHOOL", "SECRETARY", "SHORT", "TIME", "WANT", "WORK", "AFRICA", "BASKETBALL", "BIRTHDAY", "BROWN", "BUT", "CHEAT", "CITY", "COOK", "DECIDE", "FULL", "HOW", "JACKET", "LETTER", "MEDICINE", "NEED", "PAINT", "PAPER", "PULL", "PURPLE", "RIGHT", "SAME", "SON", "TELL", "THURSDAY",
] as const;

export const WLASL1000_GLOSSES = WLASL1000_LABELS as string[];

const title = (value: string) => value.toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());

export const ASL_BUILT_IN_VOCABULARY: AslVocabularyEntry[] = WLASL1000_GLOSSES.map((gloss) => ({
  gloss, text: title(gloss), category: "learning", recognition: "built-in",
}));


export const ASL_VOCABULARY = ASL_BUILT_IN_VOCABULARY;

export function createCustomAslVocabularyEntry(value: string): AslVocabularyEntry | null {
  const text = value
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[^a-zA-Z0-9 '\-]/g, "")
    .trim();
  if (!text) return null;

  return {
    gloss: text.toUpperCase(),
    text,
    category: "custom",
    recognition: "personal-calibration",
  };
}

export const MODEL_ADAPTERS: Record<LanguageId, ModelAdapter> = {
  asl: {
    id: "asl",
    shortName: "ASL",
    language: "American Sign Language",
    status: "experimental",
    modelFile: "Official WLASL1000 Pose-TGCN + MediaPipe vision + personal-DTW-v1",
    vocabulary: ASL_VOCABULARY.map((entry) => entry.gloss),
    inputFormat: "50 samples × 55 two-dimensional upper-body and hand landmarks",
    sequenceLength: 50,
    confidenceThreshold: 0.62,
    decoder: "Quantised on-device WLASL1000 Pose-TGCN; personal templates and four starter rules take priority",
    postProcessing: "Cooldown, consensus smoothing and duplicate suppression",
    version: "0.5.0-wlasl1000-pose-tgcn",
    dataset: "Official WLASL1000 OpenPose sequences and Pose-TGCN checkpoint; WLASL data are academic/computational and non-commercial only",
    summary: "A genuine local 1,000-sign ASL isolated-sign model. The published held-out Pose-TGCN benchmark is 34.86% top-1, 61.73% top-5 and 71.91% top-10; the live MediaPipe adapter remains experimental and is not unrestricted ASL translation.",
  },
  isl: {
    id: "isl",
    shortName: "ISL",
    language: "Indian Sign Language",
    status: "not-installed",
    modelFile: null,
    vocabulary: [],
    inputFormat: "Planned holistic landmark sequence",
    sequenceLength: 48,
    confidenceThreshold: 0.85,
    decoder: "Not installed",
    postProcessing: "Language-specific decoder required",
    version: "unavailable",
    dataset: "INCLUDE (CC-BY-4.0): a 100-label candidate vocabulary is audited, but no trained checkpoint is installed",
    summary: "The adapter is separate. A real 100-label ISL vocabulary manifest is ready for signer-aware training, but no ISL recognition checkpoint is installed.",
  },
  csl: {
    id: "csl",
    shortName: "CSL",
    language: "Chinese Sign Language",
    status: "not-installed",
    modelFile: null,
    vocabulary: [],
    inputFormat: "Planned holistic landmark sequence",
    sequenceLength: 64,
    confidenceThreshold: 0.86,
    decoder: "Not installed",
    postProcessing: "CSL gloss-to-Chinese decoder required",
    version: "unavailable",
    dataset: "SLR500 and CSL-Daily require an institutional research-access agreement signed by full-time staff",
    summary: "The adapter is separate, but no CSL recognition checkpoint or unlicensed vocabulary list is installed.",
  },
};

export const LANGUAGE_LIST = Object.values(MODEL_ADAPTERS);
