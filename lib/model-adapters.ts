import WLASL1000_LABELS from "../public/models/asl1000-tgcn/labels.json";

export type LanguageId = "asl" | "bsl" | "csl" | "isl";

export type ModelAdapter = {
  id: LanguageId;
  shortName: string;
  language: string;
  status: "experimental" | "personal";
  modelFile: string | null;
  vocabulary: string[];
  inputFormat: string;
  sequenceLength: number;
  confidenceThreshold: number;
  decoder: string;
  postProcessing: string;
  version: string;
  dataset: string;
  speechLocale: string;
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

export function createCustomVocabularyEntry(value: string): AslVocabularyEntry | null {
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

/** @deprecated Use createCustomVocabularyEntry for every language. */
export const createCustomAslVocabularyEntry = createCustomVocabularyEntry;

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
    speechLocale: "en-US",
    summary: "A genuine local 1,000-sign ASL isolated-sign model. The published held-out Pose-TGCN benchmark is 34.86% top-1, 61.73% top-5 and 71.91% top-10; the live MediaPipe adapter remains experimental and is not unrestricted ASL translation.",
  },
  bsl: {
    id: "bsl",
    shortName: "BSL",
    language: "British Sign Language",
    status: "personal",
    modelFile: "On-device personal landmark recognizer",
    vocabulary: [],
    inputFormat: "24 normalised hand, face and upper-body landmark samples per recorded example",
    sequenceLength: 24,
    confidenceThreshold: 0.76,
    decoder: "Signer-specific dynamic-time-warping templates, kept separate from every other sign language",
    postProcessing: "Confidence gate, temporal consensus and duplicate suppression",
    version: "personal-dtw-v2",
    dataset: "No shared BSL checkpoint is installed. Each word is intentionally learned from the signer on this device.",
    speechLocale: "en-GB",
    summary: "Ready to teach: add any BSL word or short phrase, then record two or three examples on this device.",
  },
  isl: {
    id: "isl",
    shortName: "ISL",
    language: "Indian Sign Language",
    status: "personal",
    modelFile: "On-device personal landmark recognizer",
    vocabulary: [],
    inputFormat: "24 normalised hand, face and upper-body landmark samples per recorded example",
    sequenceLength: 24,
    confidenceThreshold: 0.76,
    decoder: "Signer-specific dynamic-time-warping templates, stored only on this device",
    postProcessing: "Confidence gate, temporal consensus and duplicate suppression",
    version: "personal-dtw-v2",
    dataset: "INCLUDE (CC-BY-4.0) remains a future shared-model research source; personal examples require no uploaded video or dataset licence.",
    speechLocale: "en-IN",
    summary: "Ready to teach: create an ISL vocabulary that matches your own signing, entirely on this device.",
  },
  csl: {
    id: "csl",
    shortName: "CSL",
    language: "Chinese Sign Language",
    status: "personal",
    modelFile: "On-device personal landmark recognizer",
    vocabulary: [],
    inputFormat: "24 normalised hand, face and upper-body landmark samples per recorded example",
    sequenceLength: 24,
    confidenceThreshold: 0.76,
    decoder: "Signer-specific dynamic-time-warping templates, stored only on this device",
    postProcessing: "Confidence gate, temporal consensus and duplicate suppression",
    version: "personal-dtw-v2",
    dataset: "SLR500 and CSL-Daily remain future shared-model sources; personal examples do not use or redistribute those datasets.",
    speechLocale: "zh-CN",
    summary: "Ready to teach: label and record the CSL words or short phrases you need, privately on this device.",
  },
};

export const LANGUAGE_LIST = Object.values(MODEL_ADAPTERS);
