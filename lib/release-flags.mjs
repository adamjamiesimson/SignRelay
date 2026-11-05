// Build-time release switches, resolved identically by next.config.ts (which
// inlines the result into the app), the export scripts and the tests.
//
// Fingerspelling is research-only: an uncertain CTC recognizer without a
// validated acceptance threshold. It is OFF unless a build explicitly opts in,
// so a production export (npm run build:firebase, profile "full") never
// presents it. It is ON by default only in builds that are research by
// construction: the local automated rehearsal profile and the
// `next dev` server (detected from Next's config phase, never from NODE_ENV,
// so a stray NODE_ENV=development cannot switch a production build on).
// NEXT_PUBLIC_SIGNRELAY_FINGERSPELLING=on|off overrides both ways, but must be
// set in the build command's environment, not in a .env file (prepare-export
// rejects that), so every build step sees the same value. A production
// ("full") export refuses "on" unless SIGNRELAY_RESEARCH_EXPORT=1 is also
// set for a local export. Vercel preview URLs can be public, so all hosted
// builds exclude fingerspelling and private tooling (assertReleaseSafe).

export const FINGERSPELLING_FLAG = "NEXT_PUBLIC_SIGNRELAY_FINGERSPELLING";
export const FLAG_VALUES = new Set(["on", "off"]);

/** @param {Record<string, string | undefined>} env @param {{ devServer?: boolean }} [context] */
export function resolveFingerspelling(env = process.env, { devServer = false } = {}) {
  const explicit = env[FINGERSPELLING_FLAG];
  if (explicit !== undefined && explicit !== "") {
    if (!FLAG_VALUES.has(explicit)) throw new Error(`${FINGERSPELLING_FLAG} must be "on" or "off"`);
    return explicit;
  }
  if (env.NEXT_PUBLIC_SIGNRELAY_PROFILE === "rehearsal") return "on";
  if (devServer) return "on";
  return "off";
}

/** How ASL starter-rule words reach the transcript (lib/model-output-policy.ts).
 * "suggest" (default, every public build): shown as a suggestion a person must
 * add. "auto": inserted automatically. That is unvalidated output, so it FAILS
 * CLOSED: it is only possible in a clearly identified, non-public research
 * export, which means
 *   - the automated rehearsal profile (its default), or
 *   - NEXT_PUBLIC_SIGNRELAY_STARTER_OUTPUT=auto together with
 *     SIGNRELAY_RESEARCH_EXPORT=1 (both, deliberately),
 * and never on a hosted build (any VERCEL_ENV, production or preview). Any
 * other request for "auto" stops the build. next.config.ts calls this, so
 * every build path (Firebase, Vercel, profiles) is covered; research exports
 * are marked (RESEARCH_EXPORT_MARKER, a visible banner) and refused by
 * scripts/assert-public-export.mjs, which the deploy script runs. */
export const STARTER_OUTPUT_FLAG = "NEXT_PUBLIC_SIGNRELAY_STARTER_OUTPUT";
export const STARTER_OUTPUT_VALUES = new Set(["auto", "suggest"]);
/** @param {Record<string, string | undefined>} env */
export const isResearchExport = (env = process.env) =>
  !env.VERCEL_ENV && (env.NEXT_PUBLIC_SIGNRELAY_PROFILE === "rehearsal" || env.SIGNRELAY_RESEARCH_EXPORT === "1");
/** @param {Record<string, string | undefined>} env */
export function resolveStarterOutput(env = process.env) {
  const explicit = env[STARTER_OUTPUT_FLAG];
  if (explicit !== undefined && explicit !== "") {
    if (!STARTER_OUTPUT_VALUES.has(explicit)) throw new Error(`${STARTER_OUTPUT_FLAG} must be "auto" or "suggest"`);
    if (explicit === "auto" && !isResearchExport(env))
      throw new Error(`${STARTER_OUTPUT_FLAG}=auto inserts unvalidated sign-rule words automatically. It is refused here ` +
        (env.VERCEL_ENV ? `(hosted build, VERCEL_ENV=${env.VERCEL_ENV}). ` : "(not a research export). ") +
        "Remove it, or for a deliberate, non-public, local research export also set SIGNRELAY_RESEARCH_EXPORT=1 (never on Vercel).");
    return explicit;
  }
  return isResearchExport(env) && env.NEXT_PUBLIC_SIGNRELAY_PROFILE === "rehearsal" ? "auto" : "suggest";
}

/** Written into an export that may insert unvalidated words automatically or
 * ships research fingerspelling; the deploy check refuses such an export. */
export const RESEARCH_EXPORT_MARKER = ".signrelay-research-export";
/** Compiled into the client only when starter words are automatic: the
 * visible research banner. Artifact checks look for it. */
export const STARTER_AUTO_UI_MARKER = "Research build: sign-rule words are added automatically";

/** Throws when a production export would ship research fingerspelling by accident.
 * @param {Record<string, string | undefined>} env */
export function assertReleaseSafe(env = process.env) {
  resolveStarterOutput(env); // throws for an unacknowledged or hosted "auto", in every profile
  const profile = env.NEXT_PUBLIC_SIGNRELAY_PROFILE || "full";
  const fingerspelling = resolveFingerspelling(env);
  if (env.VERCEL_ENV && (profile !== "full" || fingerspelling === "on"
    || env.SIGNRELAY_RESEARCH_EXPORT === "1" || env.SIGNRELAY_INCLUDE_PRIVATE_CAPTURE === "1")) {
    throw new Error("Hosted exports require the full public profile with fingerspelling and private tooling off.");
  }
  if (profile === "full" && fingerspelling === "on" && env.SIGNRELAY_RESEARCH_EXPORT !== "1")
    throw new Error(`${FINGERSPELLING_FLAG}=on in a production (full) export. Research fingerspelling must not be released; ` +
      "unset it, or set SIGNRELAY_RESEARCH_EXPORT=1 as well for a deliberate, non-public research export.");
}

/** Present in the compiled client only when the fingerspelling UI is built in
 * (the spelling textarea id and the mode button label). verify-runtime checks
 * the exported JavaScript against the manifest value with these. */
export const FINGERSPELLING_UI_MARKERS = ["spelling-text", "Word Recognition"];

/** Export paths that exist only for fingerspelling. Notices are kept. */
export const FINGERSPELLING_ASSETS = {
  modelDir: "models/asl-fingerspelling",
  workers: ["fingerspelling.worker.js", "fingerspelling-vision.worker.js"],
  keptNotices: new Set(["NOTICE.md", "ACCURACY-MODEL.md", "UPRIGHT-MODEL.md"]),
};
