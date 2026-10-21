import type { LanguageId } from "./model-adapters";

/** Build-time product profile, inlined by Next.js from NEXT_PUBLIC_SIGNRELAY_PROFILE.
 * "full" is the multilingual site. "asl-demo" is the GITEX build: only the ASL
 * workspace is usable; other languages stay visible but disabled, because their
 * models are not shipped in that export. */
export type BuildProfile = "full" | "asl-demo";

export const BUILD_PROFILE: BuildProfile = process.env.NEXT_PUBLIC_SIGNRELAY_PROFILE === "asl-demo" ? "asl-demo" : "full";

export function isLanguageAvailable(language: LanguageId, profile: BuildProfile = BUILD_PROFILE) {
  return profile === "full" || language === "asl";
}

export const OUT_OF_PROFILE_LABEL = "Not in this ASL demo build";
