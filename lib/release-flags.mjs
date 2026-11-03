// Build-time release switches, resolved identically by next.config.ts (which
// inlines the result into the app), the export scripts and the tests.
//
// Fingerspelling is research-only: an uncertain CTC recognizer without a
// validated acceptance threshold. It is OFF unless a build explicitly opts in,
// so a production export (npm run build:firebase, profile "full") never
// presents it. It is ON by default only in builds that are research by
// construction: the automated rehearsal profile, a Vercel preview, and
// `next dev`. NEXT_PUBLIC_SIGNRELAY_FINGERSPELLING=on|off overrides both ways.

export const FINGERSPELLING_FLAG = "NEXT_PUBLIC_SIGNRELAY_FINGERSPELLING";
export const FLAG_VALUES = new Set(["on", "off"]);

/** @param {Record<string, string | undefined>} env */
export function resolveFingerspelling(env = process.env) {
  const explicit = env[FINGERSPELLING_FLAG];
  if (explicit !== undefined && explicit !== "") {
    if (!FLAG_VALUES.has(explicit)) throw new Error(`${FINGERSPELLING_FLAG} must be "on" or "off"`);
    return explicit;
  }
  if (env.NEXT_PUBLIC_SIGNRELAY_PROFILE === "rehearsal") return "on";
  if (env.VERCEL_ENV === "preview") return "on";
  if (env.NODE_ENV === "development") return "on";
  return "off";
}

/** Export paths that exist only for fingerspelling. Notices are kept. */
export const FINGERSPELLING_ASSETS = {
  modelDir: "models/asl-fingerspelling",
  workers: ["fingerspelling.worker.js", "fingerspelling-vision.worker.js"],
  keptNotices: new Set(["NOTICE.md", "ACCURACY-MODEL.md", "UPRIGHT-MODEL.md"]),
};
