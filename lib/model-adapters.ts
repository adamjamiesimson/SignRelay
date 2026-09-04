import WLASL2000_LABELS from "../public/models/asl2000-tgcn/labels.json";

export type LanguageId = "asl" | "auslan" | "bsl" | "csl" | "isl" | "lse";

export type ModelAdapter = {
  id: LanguageId;
  shortName: string;
  language: string;
  /** `experimental` means a browser-loadable shared model is installed. */
  status: "experimental" | "personal" | "preparing";
  modelFile: string | null;
  /** Number of shared model labels that run without a personal recording. */
  automaticVocabularyCount: number;
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

export const WLASL2000_GLOSSES = WLASL2000_LABELS as string[];

const title = (value: string) => value.toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());

export const ASL_BUILT_IN_VOCABULARY: AslVocabularyEntry[] = WLASL2000_GLOSSES.map((gloss) => ({
  gloss, text: title(gloss), category: "learning", recognition: "built-in",
}));


export const ASL_VOCABULARY = ASL_BUILT_IN_VOCABULARY;

/**
 * These are intentionally language-neutral *labels*, not claims that a
 * single sign form is shared by BSL, CSL or ISL. They make a substantial
 * starter dictionary available to teach in each language without inventing
 * an unvalidated shared checkpoint.
 */
export const PERSONAL_STARTER_GLOSSES = [
  ["HELLO", "GOODBYE", "PLEASE", "THANK YOU", "SORRY", "EXCUSE ME", "YES", "NO", "MAYBE", "OKAY", "HELP", "STOP", "WAIT", "AGAIN", "UNDERSTAND", "DON'T UNDERSTAND", "NICE", "WELCOME", "READY", "FINISH"],
  ["PERSON", "MAN", "WOMAN", "CHILD", "BABY", "FRIEND", "NEIGHBOUR", "TEACHER", "STUDENT", "DOCTOR", "NURSE", "DRIVER", "CUSTOMER", "VISITOR", "MOTHER", "FATHER", "SISTER", "BROTHER", "GRANDMOTHER", "GRANDFATHER"],
  ["FAMILY", "PARENT", "SON", "DAUGHTER", "HUSBAND", "WIFE", "PARTNER", "AUNT", "UNCLE", "COUSIN", "RELATIVE", "MARRIED", "SINGLE", "LOVE", "MISS", "MEET", "CALL", "INVITE", "CELEBRATE", "TOGETHER"],
  ["GO", "COME", "LEAVE", "ARRIVE", "WALK", "RUN", "SIT", "STAND", "OPEN", "CLOSE", "GIVE", "TAKE", "PUT", "FIND", "LOSE", "BUY", "SELL", "PAY", "CHOOSE", "CHANGE"],
  ["WAKE UP", "SLEEP", "SHOWER", "WASH", "DRESS", "COOK", "CLEAN", "EAT", "DRINK", "REST", "PLAY", "WATCH", "LISTEN", "READ", "WRITE", "SIGN", "TALK", "THINK", "REMEMBER", "FORGET"],
  ["FOOD", "BREAD", "RICE", "NOODLES", "PASTA", "SOUP", "SALAD", "CHICKEN", "FISH", "MEAT", "EGG", "CHEESE", "FRUIT", "APPLE", "BANANA", "ORANGE", "VEGETABLE", "PIZZA", "CAKE", "SWEET"],
  ["WATER", "TEA", "COFFEE", "JUICE", "MILK", "HOT", "COLD", "HUNGRY", "THIRSTY", "BREAKFAST", "LUNCH", "DINNER", "SNACK", "RESTAURANT", "MENU", "BILL", "DELICIOUS", "SPICY", "SUGAR", "SALT"],
  ["HAPPY", "SAD", "ANGRY", "WORRIED", "SCARED", "TIRED", "EXCITED", "SURPRISED", "BORED", "CONFUSED", "PROUD", "SHY", "CALM", "STRESSED", "SICK", "BETTER", "WORSE", "BUSY", "FREE", "LUCKY"],
  ["HOME", "SCHOOL", "UNIVERSITY", "OFFICE", "SHOP", "MARKET", "HOSPITAL", "PHARMACY", "BANK", "HOTEL", "AIRPORT", "STATION", "PARK", "BEACH", "MOSQUE", "CHURCH", "TOILET", "KITCHEN", "BEDROOM", "BATHROOM"],
  ["TODAY", "TOMORROW", "YESTERDAY", "NOW", "LATER", "EARLY", "LATE", "MORNING", "AFTERNOON", "EVENING", "NIGHT", "WEEK", "MONTH", "YEAR", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "WEEKEND"],
  ["ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE", "TEN", "ELEVEN", "TWELVE", "TWENTY", "FIFTY", "HUNDRED", "THOUSAND", "FIRST", "LAST", "MORE", "LESS"],
  ["BLACK", "WHITE", "RED", "BLUE", "GREEN", "YELLOW", "ORANGE COLOUR", "PURPLE", "PINK", "BROWN", "GREY", "GOLD", "SILVER", "LIGHT", "DARK", "BRIGHT", "COLOUR", "SAME", "DIFFERENT", "BEAUTIFUL"],
  ["SUN", "RAIN", "WIND", "CLOUD", "STORM", "HOT WEATHER", "COLD WEATHER", "WEATHER", "UMBRELLA", "SUMMER", "WINTER", "SPRING", "AUTUMN", "DAY", "TEMPERATURE", "WET", "DRY", "DUST", "FLOOD", "SUNNY"],
  ["LEARN", "STUDY", "CLASS", "COURSE", "BOOK", "PAPER", "PEN", "COMPUTER", "EXAM", "QUESTION", "ANSWER", "EXPLAIN", "PRACTICE", "CORRECT", "WRONG", "EASY", "DIFFICULT", "IDEA", "PROJECT", "HOMEWORK"],
  ["PHONE", "MOBILE", "INTERNET", "EMAIL", "MESSAGE", "VIDEO", "PHOTO", "CAMERA", "CHARGER", "BATTERY", "SCREEN", "KEYBOARD", "PASSWORD", "WEBSITE", "DOWNLOAD", "UPLOAD", "ONLINE", "OFFLINE", "MACHINE", "ROBOT"],
  ["PAIN", "HEADACHE", "MEDICINE", "APPOINTMENT", "EMERGENCY", "ALLERGY", "INJURY", "BLOOD", "HEART", "BREATHE", "DIZZY", "FEVER", "COUGH", "MASK", "HEALTHY", "EXERCISE", "GYM", "SWIM", "SLEEPY", "RECOVER"],
  ["DANGER", "SAFE", "POLICE", "FIRE", "ACCIDENT", "LOST", "ADDRESS", "NAME", "PHONE NUMBER", "CONTACT", "NEED ASSISTANCE", "CALL POLICE", "CALL AMBULANCE", "EXIT", "ENTRANCE", "LOCK", "UNLOCK", "CAREFUL", "WARNING", "PROBLEM"],
  ["CAR", "BUS", "TAXI", "TRAIN", "METRO", "PLANE", "BOAT", "BICYCLE", "ROAD", "TRAFFIC", "TICKET", "MAP", "DIRECTION", "LEFT", "RIGHT", "STRAIGHT", "NEAR", "FAR", "FAST", "SLOW"],
  ["DOOR", "WINDOW", "TABLE", "CHAIR", "BED", "SOFA", "LIGHT SWITCH", "FAN", "AIR CONDITIONING", "FRIDGE", "OVEN", "CUP", "PLATE", "BOWL", "SPOON", "FORK", "KNIFE", "KEY", "BAG", "CLOTHES"],
  ["WORK", "JOB", "MEETING", "MANAGER", "TEAM", "CLIENT", "MONEY", "PRICE", "CHEAP", "EXPENSIVE", "RECEIPT", "CASH", "CARD", "DELIVERY", "ORDER", "RETURN", "DISCOUNT", "OPEN NOW", "CLOSED", "AVAILABLE"],
  ["WHO", "WHAT", "WHERE", "WHEN", "WHY", "HOW", "WHICH", "HOW MANY", "HOW MUCH", "CAN", "CAN'T", "WANT", "NEED", "LIKE", "DON'T LIKE", "KNOW", "NOT KNOW", "HAVE", "DON'T HAVE", "SHOULD"],
  ["GOOD", "BAD", "BIG", "SMALL", "LONG", "SHORT", "NEW", "OLD", "YOUNG", "FULL", "EMPTY", "POLITE", "DIRTY", "STRONG", "WEAK", "QUIET", "LOUD", "TRUE", "FALSE", "IMPORTANT"],
] as const satisfies readonly (readonly string[])[];

export const PERSONAL_STARTER_CONCEPTS = Array.from(new Set([
  ...WLASL2000_GLOSSES,
  ...PERSONAL_STARTER_GLOSSES.flat(),
]));

export const PERSONAL_STARTER_VOCABULARY: AslVocabularyEntry[] = PERSONAL_STARTER_CONCEPTS
  .map((gloss) => ({ gloss, text: title(gloss), category: "learning", recognition: "personal-calibration" }));

export function createCustomVocabularyEntry(value: string): AslVocabularyEntry | null {
  const text = value
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N} '\-]/gu, "")
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
    modelFile: "Official WLASL2000 Pose-TGCN + MediaPipe vision + personal-DTW-v1",
    automaticVocabularyCount: 2000,
    vocabulary: ASL_VOCABULARY.map((entry) => entry.gloss),
    inputFormat: "50 samples × 55 two-dimensional upper-body and hand landmarks",
    sequenceLength: 50,
    confidenceThreshold: 0.62,
    decoder: "Quantised on-device WLASL2000 Pose-TGCN; personal templates and four starter rules take priority",
    postProcessing: "Cooldown, consensus smoothing and duplicate suppression",
    version: "0.6.0-wlasl2000-pose-tgcn",
    dataset: "Official WLASL2000 OpenPose sequences and Pose-TGCN checkpoint; WLASL data are academic/computational and non-commercial only",
    speechLocale: "en-US",
    summary: "A genuine local 2,000-sign ASL isolated-sign model. The live MediaPipe adapter remains experimental and is not unrestricted ASL translation.",
  },
  lse: {
    id: "lse",
    shortName: "LSE",
    language: "Spanish Sign Language",
    // The installer workflow changes this to `experimental` only in the
    // commit that contains its trained ONNX asset and labels.
    status: "preparing",
    modelFile: null,
    automaticVocabularyCount: 0,
    vocabulary: [],
    inputFormat: "64 body-and-hand landmark frames (19 pose points + two 21-point hands, x/y/z)",
    sequenceLength: 64,
    confidenceThreshold: 0.76,
    decoder: "Official SWL-LSE MediaPipe landmark pipeline; browser model is being prepared from its real-signer training split",
    postProcessing: "Will use confidence and margin gating plus temporal consensus when the model is installed",
    version: "swl-lse300-browser-model-pending",
    dataset: "SWL-LSE (SignaMed), 8,000 real signer sequences across 300 Spanish Sign Language health-domain signs; open Zenodo release.",
    speechLocale: "es-ES",
    summary: "A real 300-sign LSE browser model is being built from the open SWL-LSE landmark dataset. It is not marked installed until the trained model passes its build.",
  },
  auslan: {
    id: "auslan",
    shortName: "AUSLAN",
    language: "Australian Sign Language",
    status: "preparing",
    modelFile: null,
    automaticVocabularyCount: 0,
    vocabulary: [],
    inputFormat: "Planned: video/pose sequence model using the official MM-WLAuslan data contract",
    sequenceLength: 0,
    confidenceThreshold: 0,
    decoder: "No browser checkpoint is installed yet",
    postProcessing: "No automatic output until an evaluated Auslan model is installed",
    version: "mm-wlauslan-model-pending",
    dataset: "MM-WLAuslan: 282,000+ videos, 3,215 Auslan glosses and 73 signers (CC BY-NC-SA 4.0).",
    speechLocale: "en-AU",
    summary: "Official MM-WLAuslan data is mapped for a future 3,215-gloss model. No automatic Auslan translation is claimed until that model exists.",
  },
  bsl: {
    id: "bsl",
    shortName: "BSL",
    language: "British Sign Language",
    status: "experimental",
    modelFile: "Official BSL-1K Pose2Sign body-and-hands model + on-device personal recognizer",
    automaticVocabularyCount: 1064,
    vocabulary: PERSONAL_STARTER_CONCEPTS,
    inputFormat: "16 body-and-hand pose frames (OpenPose COCO-18 + two 21-point hands); private examples use 24 samples",
    sequenceLength: 16,
    confidenceThreshold: 0.82,
    decoder: "Official BSL-1K Pose2Sign browser model with WebGPU/WASM inference; personal templates take priority",
    postProcessing: "Confidence gate, temporal consensus and duplicate suppression",
    version: "bsl1k-pose2sign-bodyhands-v1 + personal-dtw-v2",
    dataset: "Official BSL-1K body-and-hands Pose2Sign checkpoint. The live MediaPipe-to-OpenPose adapter is experimental.",
    speechLocale: "en-GB",
    summary: "A genuine local 1,064-sign BSL isolated-sign model, plus a separate private vocabulary you can teach.",
  },
  isl: {
    id: "isl",
    shortName: "ISL",
    language: "Indian Sign Language",
    status: "experimental",
    modelFile: "Official AI4Bharat INCLUDE-263 landmark transformer + on-device personal recognizer",
    automaticVocabularyCount: 263,
    vocabulary: PERSONAL_STARTER_CONCEPTS,
    inputFormat: "Up to 200 MediaPipe body and hand frames (134 x/y landmark features); private examples use 24 samples",
    sequenceLength: 200,
    confidenceThreshold: 0.78,
    decoder: "Official INCLUDE-263 browser transformer with WebGPU/WASM inference; personal templates take priority",
    postProcessing: "Confidence gate, temporal consensus and duplicate suppression",
    version: "include263-small-transformer-v1 + personal-dtw-v2",
    dataset: "Official AI4Bharat INCLUDE-263 landmark model (CC-BY-4.0); the live MediaPipe adapter is experimental. Personal examples require no uploaded video.",
    speechLocale: "en-IN",
    summary: "A genuine local 263-sign ISL isolated-sign model, plus a separate private vocabulary you can teach.",
  },
  csl: {
    id: "csl",
    shortName: "CSL",
    language: "Chinese Sign Language",
    status: "personal",
    modelFile: "On-device personal landmark recognizer",
    automaticVocabularyCount: 0,
    vocabulary: PERSONAL_STARTER_CONCEPTS,
    inputFormat: "24 normalised hand, face and upper-body landmark samples per recorded example",
    sequenceLength: 24,
    confidenceThreshold: 0.76,
    decoder: "Signer-specific dynamic-time-warping templates, stored only on this device",
    postProcessing: "Confidence gate, temporal consensus and duplicate suppression",
    version: "personal-dtw-v2",
    dataset: "SLR500 and CSL-Daily remain future shared-model sources; personal examples do not use or redistribute those datasets.",
    speechLocale: "zh-CN",
    summary: "2,000+ built-in CSL starter concepts, ready to teach privately on this device.",
  },
};

export const LANGUAGE_LIST = Object.values(MODEL_ADAPTERS);
