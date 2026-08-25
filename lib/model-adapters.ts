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
  category: "conversation" | "actions" | "food" | "feelings" | "people" | "places" | "learning" | "questions" | "time" | "safety";
  recognition: "built-in" | "personal-calibration";
};

export const ASL_BUILT_IN_VOCABULARY: AslVocabularyEntry[] = [
  { gloss: "HELLO", text: "Hello", category: "conversation", recognition: "built-in" },
  { gloss: "THANK YOU", text: "Thank you", category: "conversation", recognition: "built-in" },
  { gloss: "YES", text: "Yes", category: "conversation", recognition: "built-in" },
  { gloss: "I LOVE YOU", text: "I love you", category: "feelings", recognition: "built-in" },
];

export const ASL_PERSONAL_VOCABULARY: AslVocabularyEntry[] = [
  { gloss: "NO", text: "No", category: "conversation", recognition: "personal-calibration" },
  { gloss: "PLEASE", text: "Please", category: "conversation", recognition: "personal-calibration" },
  { gloss: "SORRY", text: "Sorry", category: "conversation", recognition: "personal-calibration" },
  { gloss: "HELP", text: "Help", category: "safety", recognition: "personal-calibration" },
  { gloss: "WANT", text: "Want", category: "actions", recognition: "personal-calibration" },
  { gloss: "NEED", text: "Need", category: "actions", recognition: "personal-calibration" },
  { gloss: "LIKE", text: "Like", category: "feelings", recognition: "personal-calibration" },
  { gloss: "LOVE", text: "Love", category: "feelings", recognition: "personal-calibration" },
  { gloss: "GO", text: "Go", category: "actions", recognition: "personal-calibration" },
  { gloss: "COME", text: "Come", category: "actions", recognition: "personal-calibration" },
  { gloss: "STOP", text: "Stop", category: "safety", recognition: "personal-calibration" },
  { gloss: "WAIT", text: "Wait", category: "actions", recognition: "personal-calibration" },
  { gloss: "EAT", text: "Eat", category: "food", recognition: "personal-calibration" },
  { gloss: "DRINK", text: "Drink", category: "food", recognition: "personal-calibration" },
  { gloss: "WATER", text: "Water", category: "food", recognition: "personal-calibration" },
  { gloss: "FOOD", text: "Food", category: "food", recognition: "personal-calibration" },
  { gloss: "MORE", text: "More", category: "conversation", recognition: "personal-calibration" },
  { gloss: "FINISH", text: "Finish", category: "actions", recognition: "personal-calibration" },
  { gloss: "AGAIN", text: "Again", category: "conversation", recognition: "personal-calibration" },
  { gloss: "GOOD", text: "Good", category: "feelings", recognition: "personal-calibration" },
  { gloss: "BAD", text: "Bad", category: "feelings", recognition: "personal-calibration" },
  { gloss: "HAPPY", text: "Happy", category: "feelings", recognition: "personal-calibration" },
  { gloss: "SAD", text: "Sad", category: "feelings", recognition: "personal-calibration" },
  { gloss: "FAMILY", text: "Family", category: "people", recognition: "personal-calibration" },
  { gloss: "MOTHER", text: "Mother", category: "people", recognition: "personal-calibration" },
  { gloss: "FATHER", text: "Father", category: "people", recognition: "personal-calibration" },
  { gloss: "FRIEND", text: "Friend", category: "people", recognition: "personal-calibration" },
  { gloss: "HOME", text: "Home", category: "places", recognition: "personal-calibration" },
  { gloss: "SCHOOL", text: "School", category: "places", recognition: "personal-calibration" },
  { gloss: "WORK", text: "Work", category: "places", recognition: "personal-calibration" },
  { gloss: "BOOK", text: "Book", category: "learning", recognition: "personal-calibration" },
  { gloss: "LEARN", text: "Learn", category: "learning", recognition: "personal-calibration" },
  { gloss: "TEACH", text: "Teach", category: "learning", recognition: "personal-calibration" },
  { gloss: "UNDERSTAND", text: "Understand", category: "learning", recognition: "personal-calibration" },
  { gloss: "KNOW", text: "Know", category: "learning", recognition: "personal-calibration" },
  { gloss: "NAME", text: "Name", category: "conversation", recognition: "personal-calibration" },
  { gloss: "WHO", text: "Who", category: "questions", recognition: "personal-calibration" },
  { gloss: "WHAT", text: "What", category: "questions", recognition: "personal-calibration" },
  { gloss: "WHERE", text: "Where", category: "questions", recognition: "personal-calibration" },
  { gloss: "WHEN", text: "When", category: "questions", recognition: "personal-calibration" },
  { gloss: "WHY", text: "Why", category: "questions", recognition: "personal-calibration" },
  { gloss: "HOW", text: "How", category: "questions", recognition: "personal-calibration" },
  { gloss: "TODAY", text: "Today", category: "time", recognition: "personal-calibration" },
  { gloss: "TOMORROW", text: "Tomorrow", category: "time", recognition: "personal-calibration" },
  { gloss: "YESTERDAY", text: "Yesterday", category: "time", recognition: "personal-calibration" },
  { gloss: "MORNING", text: "Morning", category: "time", recognition: "personal-calibration" },
  { gloss: "NIGHT", text: "Night", category: "time", recognition: "personal-calibration" },
  { gloss: "BATHROOM", text: "Bathroom", category: "places", recognition: "personal-calibration" },
  { gloss: "DOCTOR", text: "Doctor", category: "safety", recognition: "personal-calibration" },
  { gloss: "EMERGENCY", text: "Emergency", category: "safety", recognition: "personal-calibration" },
];

export const ASL_VOCABULARY = [...ASL_BUILT_IN_VOCABULARY, ...ASL_PERSONAL_VOCABULARY];

export const MODEL_ADAPTERS: Record<LanguageId, ModelAdapter> = {
  asl: {
    id: "asl",
    shortName: "ASL",
    language: "American Sign Language",
    status: "experimental",
    modelFile: "MediaPipe Gesture Recognizer v1 + temporal-rules-v0.2 + personal-DTW-v1",
    vocabulary: ASL_VOCABULARY.map((entry) => entry.gloss),
    inputFormat: "21 hand landmarks × 2, selected face cues, upper-body pose",
    sequenceLength: 32,
    confidenceThreshold: 0.82,
    decoder: "Hybrid pretrained handshape, temporal rules and on-device personal DTW templates",
    postProcessing: "Cooldown, consensus smoothing and duplicate suppression",
    version: "0.2.0-research",
    dataset: "Pretrained MediaPipe gesture model; motion rules and personal templates are not dataset-trained",
    summary: "Four starter signs plus a 50-word on-device personal vocabulary pack. It does not translate unrestricted ASL.",
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
    dataset: "Candidate research source: INCLUDE; licensing must be verified before training",
    summary: "The adapter is separate, but no ISL recognition checkpoint is installed.",
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
    dataset: "Candidate research source: CSL-Daily; access terms must be verified",
    summary: "The adapter is separate, but no CSL recognition checkpoint is installed.",
  },
};

export const LANGUAGE_LIST = Object.values(MODEL_ADAPTERS);
