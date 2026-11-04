/** Inlined at build time from lib/release-flags.mjs via next.config.ts. A
 * literal comparison lets the bundler drop disabled branches. */
export const FINGERSPELLING_ENABLED = process.env.NEXT_PUBLIC_SIGNRELAY_FINGERSPELLING === "on";

/** "suggest": starter-rule words must be added by a person; "auto": research builds. */
export const STARTER_OUTPUT: "auto" | "suggest" = process.env.NEXT_PUBLIC_SIGNRELAY_STARTER_OUTPUT === "auto" ? "auto" : "suggest";
