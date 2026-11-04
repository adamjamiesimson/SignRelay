// Build-time release switches, resolved identically by next.config.ts (which
// inlines the result into the app), the export scripts and the tests.
//
// Fingerspelling is research-only: an uncertain CTC recognizer without a
// validated acceptance threshold. It is OFF unless a build explicitly opts in,
// so a production export (npm run build:firebase, profile "full") never
// presents it. It is ON by default only in builds that are research by
// construction: the automated rehearsal profile, a Vercel preview, and the
// `next dev` server (detected from Next's config phase, never from NODE_ENV,
// so a stray NODE_ENV=development cannot switch a production build on).
// NEXT_PUBLIC_SIGNRELAY_FINGERSPELLING=on|off overrides both ways, but must be
// set in the build command's environment, not in a .env file (prepare-export
// rejects that), so every build step sees the same value. A production
// ("full") export that is not a Vercel preview refuses "on" unless
// SIGNRELAY_RESEARCH_EXPORT=1 is also set (assertReleaseSafe).

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
  if (env.VERCEL_ENV === "preview") return "on";
  if (devServer) return "on";
  return "off";
}

/** How ASL starter-rule words reach the transcript (lib/model-output-policy.ts).
 * "suggest" (default): shown as a suggestion a person must add. "auto": the
 * pre-safeguard behaviour, inserted automatically, kept for research builds.
 * The automated rehearsal profile defaults to "auto" so automatic recognition
 * can still be studied; every other build, including production, defaults to
 * "suggest". NEXT_PUBLIC_SIGNRELAY_STARTER_OUTPUT=auto|suggest overrides. */
export const STARTER_OUTPUT_FLAG = "NEXT_PUBLIC_SIGNRELAY_STARTER_OUTPUT";
export const STARTER_OUTPUT_VALUES = new Set(["auto", "suggest"]);
/** @param {Record<string, string | undefined>} env */
export function resolveStarterOutput(env = process.env) {
  const explicit = env[STARTER_OUTPUT_FLAG];
  if (explicit !== undefined && explicit !== "") {
    if (!STARTER_OUTPUT_VALUES.has(explicit)) throw new Error(`${STARTER_OUTPUT_FLAG} must be "auto" or "suggest"`);
    return explicit;
  }
  return env.NEXT_PUBLIC_SIGNRELAY_PROFILE === "rehearsal" ? "auto" : "suggest";
}

/** Throws when a production export would ship research fingerspelling by accident.
 * @param {Record<string, string | undefined>} env */
export function assertReleaseSafe(env = process.env) {
  const profile = env.NEXT_PUBLIC_SIGNRELAY_PROFILE || "full";
  if (profile !== "full" || env.VERCEL_ENV === "preview") return;
  if (resolveFingerspelling(env) === "on" && env.SIGNRELAY_RESEARCH_EXPORT !== "1")
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
