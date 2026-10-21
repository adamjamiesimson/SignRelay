import type { LanguageId } from "./model-adapters";

/** Build-time product profile, inlined by Next.js from NEXT_PUBLIC_SIGNRELAY_PROFILE.
 * "full" is the multilingual site. "asl-demo" is the GITEX build: only the ASL
 * workspace is usable; other languages stay visible but disabled, because their
 * models are not shipped in that export. "rehearsal" is the asl-demo build plus
 * a clearly labelled hook for automated software rehearsals with synthetic
 * landmarks; it is never served as the demo (demo:serve refuses it). */
export type BuildProfile = "full" | "asl-demo" | "rehearsal";

const configured = process.env.NEXT_PUBLIC_SIGNRELAY_PROFILE;
export const BUILD_PROFILE: BuildProfile = configured === "asl-demo" || configured === "rehearsal" ? configured : "full";
/** Both GITEX profiles ship the ASL workspace only. */
export const ASL_ONLY = BUILD_PROFILE !== "full";

export function isLanguageAvailable(language: LanguageId, profile: BuildProfile = BUILD_PROFILE) {
  return profile === "full" || language === "asl";
}

export const OUT_OF_PROFILE_LABEL = "Not in this ASL demo build";
