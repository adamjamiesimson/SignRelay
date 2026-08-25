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

const title = (value: string) => value.toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());

export const ASL_BUILT_IN_VOCABULARY: AslVocabularyEntry[] = WLASL100_GLOSSES.map((gloss) => ({
  gloss, text: title(gloss), category: "learning", recognition: "built-in",
}));

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
  { gloss: "EXCUSE ME", text: "Excuse me", category: "conversation", recognition: "personal-calibration" },
  { gloss: "GOODBYE", text: "Goodbye", category: "conversation", recognition: "personal-calibration" },
  { gloss: "WELCOME", text: "Welcome", category: "conversation", recognition: "personal-calibration" },
  { gloss: "ME", text: "Me", category: "people", recognition: "personal-calibration" },
  { gloss: "YOU", text: "You", category: "people", recognition: "personal-calibration" },
  { gloss: "WE", text: "We", category: "people", recognition: "personal-calibration" },
  { gloss: "THEY", text: "They", category: "people", recognition: "personal-calibration" },
  { gloss: "CAN", text: "Can", category: "actions", recognition: "personal-calibration" },
  { gloss: "CANNOT", text: "Cannot", category: "actions", recognition: "personal-calibration" },
  { gloss: "DO", text: "Do", category: "actions", recognition: "personal-calibration" },
  { gloss: "MAKE", text: "Make", category: "actions", recognition: "personal-calibration" },
  { gloss: "GIVE", text: "Give", category: "actions", recognition: "personal-calibration" },
  { gloss: "TAKE", text: "Take", category: "actions", recognition: "personal-calibration" },
  { gloss: "OPEN", text: "Open", category: "actions", recognition: "personal-calibration" },
  { gloss: "CLOSE", text: "Close", category: "actions", recognition: "personal-calibration" },
  { gloss: "CALL", text: "Call", category: "actions", recognition: "personal-calibration" },
  { gloss: "SLEEP", text: "Sleep", category: "actions", recognition: "personal-calibration" },
  { gloss: "COFFEE", text: "Coffee", category: "food", recognition: "personal-calibration" },
  { gloss: "TEA", text: "Tea", category: "food", recognition: "personal-calibration" },
  { gloss: "BREAKFAST", text: "Breakfast", category: "food", recognition: "personal-calibration" },
  { gloss: "LUNCH", text: "Lunch", category: "food", recognition: "personal-calibration" },
  { gloss: "DINNER", text: "Dinner", category: "food", recognition: "personal-calibration" },
  { gloss: "TIRED", text: "Tired", category: "feelings", recognition: "personal-calibration" },
  { gloss: "ANGRY", text: "Angry", category: "feelings", recognition: "personal-calibration" },
  { gloss: "SCARED", text: "Scared", category: "feelings", recognition: "personal-calibration" },
  { gloss: "EXCITED", text: "Excited", category: "feelings", recognition: "personal-calibration" },
  { gloss: "FINE", text: "Fine", category: "feelings", recognition: "personal-calibration" },
  { gloss: "SICK", text: "Sick", category: "feelings", recognition: "personal-calibration" },
  { gloss: "BROTHER", text: "Brother", category: "people", recognition: "personal-calibration" },
  { gloss: "SISTER", text: "Sister", category: "people", recognition: "personal-calibration" },
  { gloss: "CHILD", text: "Child", category: "people", recognition: "personal-calibration" },
  { gloss: "TEACHER", text: "Teacher", category: "people", recognition: "personal-calibration" },
  { gloss: "HOSPITAL", text: "Hospital", category: "places", recognition: "personal-calibration" },
  { gloss: "STORE", text: "Store", category: "places", recognition: "personal-calibration" },
  { gloss: "CAR", text: "Car", category: "places", recognition: "personal-calibration" },
  { gloss: "OFFICE", text: "Office", category: "places", recognition: "personal-calibration" },
  { gloss: "RESTAURANT", text: "Restaurant", category: "places", recognition: "personal-calibration" },
  { gloss: "READ", text: "Read", category: "learning", recognition: "personal-calibration" },
  { gloss: "WRITE", text: "Write", category: "learning", recognition: "personal-calibration" },
  { gloss: "QUESTION", text: "Question", category: "learning", recognition: "personal-calibration" },
  { gloss: "ANSWER", text: "Answer", category: "learning", recognition: "personal-calibration" },
  { gloss: "CLASS", text: "Class", category: "learning", recognition: "personal-calibration" },
  { gloss: "NOW", text: "Now", category: "time", recognition: "personal-calibration" },
  { gloss: "LATER", text: "Later", category: "time", recognition: "personal-calibration" },
  { gloss: "WEEK", text: "Week", category: "time", recognition: "personal-calibration" },
  { gloss: "MONTH", text: "Month", category: "time", recognition: "personal-calibration" },
  { gloss: "YEAR", text: "Year", category: "time", recognition: "personal-calibration" },
  { gloss: "POLICE", text: "Police", category: "safety", recognition: "personal-calibration" },
  { gloss: "DANGER", text: "Danger", category: "safety", recognition: "personal-calibration" },
  { gloss: "MEDICINE", text: "Medicine", category: "safety", recognition: "personal-calibration" },
];

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
    modelFile: "Local WLASL100 landmark MLP + MediaPipe vision + personal-DTW-v1",
    vocabulary: ASL_VOCABULARY.map((entry) => entry.gloss),
    inputFormat: "24 frames × 54 two-dimensional upper-body and hand landmarks",
    sequenceLength: 24,
    confidenceThreshold: 0.82,
    decoder: "Quantised on-device WLASL100 isolated-sign model; personal templates and four starter rules take priority",
    postProcessing: "Cooldown, consensus smoothing and duplicate suppression",
    version: "0.4.0-wlasl100-experimental",
    dataset: "WLASL100 landmark sequences from the SPOTER supplementary release (CC BY-NC 4.0); WLASL data are research/non-commercial only",
    summary: "A genuine local 100-sign ASL isolated-sign model. Initial untouched signer-independent test result: 29.8% top-1 and 52.7% top-5; it is for testing and research, not unrestricted ASL translation.",
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
