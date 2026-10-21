import { MODEL_ADAPTERS, type LanguageId } from "./model-adapters";

/** What the product may claim for each workspace, from committed evidence
 * (docs/evaluation/dashboard-2026-10-21.md). Nothing here is a measured
 * live-camera accuracy, and nothing has independent fluent-signer validation. */
export const ASL_DEMO_WORDS = ["HELLO", "THANK YOU", "PLEASE", "SORRY", "YES", "NO"] as const;

export type Capability = {
  tier: "research-model" | "clip-mode" | "personal-only" | "preparing";
  headline: string;
  evidence: string;
  independentlyValidated: false;
};

export function capabilityStatus(language: LanguageId): Capability {
  const model = MODEL_ADAPTERS[language];
  if (language === "asl") return { tier: "research-model", independentlyValidated: false,
    headline: "Research preview. Six demo words use simple movement rules; a 2,000-sign research model runs alongside them.",
    evidence: "On 11 previously seen, publisher-labelled development clips: 5 correct, 0 wrong, 6 no-match (PLEASE 3/3, NO 1/1, HELLO 1/3, THANK YOU 0/3, YES 0/1; SORRY untested). Not tested on new signers, live cameras or non-signing movement." };
  if (language === "rsl" || language === "bdsl") return { tier: "clip-mode", independentlyValidated: false,
    headline: `Research preview. One sign per capture from a ${model.automaticVocabularyCount.toLocaleString()}-class model; suggestions are not added to a transcript.`,
    evidence: "Published dataset results only. SignRelay live-camera accuracy has not been measured." };
  if (language === "psl") return { tier: "research-model", independentlyValidated: false,
    headline: `Research preview. ${model.automaticVocabularyCount.toLocaleString()} dictionary signs, each matched against one recorded reference performance. There is no trained model.`,
    evidence: "No live-camera or held-out evaluation exists for this language." };
  if (model.status === "experimental") return { tier: "research-model", independentlyValidated: false,
    headline: `Research preview. ${model.automaticVocabularyCount.toLocaleString()} isolated signs from a shared research model.`,
    evidence: "SignRelay live-camera accuracy has not been measured for this language." };
  if (model.status === "preparing") return { tier: "preparing", independentlyValidated: false,
    headline: "Personal signs only. No automatic model is installed yet.", evidence: "No automatic recognition is claimed." };
  return { tier: "personal-only", independentlyValidated: false,
    headline: `Personal signs only. Record examples to activate your ${model.shortName} vocabulary.`, evidence: "No automatic recognition is claimed." };
}

export const SIGN_LANGUAGE_NOTE = "Sign languages are complete languages with their own grammar, not signed versions of spoken languages. SignRelay recognizes isolated signs and shows English word labels; it does not translate full sentences.";
