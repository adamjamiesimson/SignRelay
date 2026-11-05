import { readdir, readFile, rm } from "node:fs/promises";

import { FINGERSPELLING_FLAG, STARTER_OUTPUT_FLAG, assertReleaseSafe, resolveFingerspelling, resolveStarterOutput } from "../lib/release-flags.mjs";
const publicKeys = new Set(["NEXT_PUBLIC_GA_MEASUREMENT_ID", "NEXT_PUBLIC_SIGNRELAY_PROFILE", FINGERSPELLING_FLAG, STARTER_OUTPUT_FLAG]);
const PROFILES = new Set(["full", "asl-demo", "rehearsal"]);
// Vercel's system environment variables can be hidden. Its build command
// identifies the hosted path even without VERCEL_ENV.
const env = process.argv.includes("--hosted") ? { ...process.env, VERCEL_ENV: process.env.VERCEL_ENV || "hosted" } : process.env;
function validate(key, value) {
  if (!key.startsWith("NEXT_PUBLIC_")) return;
  if (!publicKeys.has(key)) throw new Error(`Unsupported public environment variable: ${key}. Never expose credentials through NEXT_PUBLIC_.`);
  if (key === FINGERSPELLING_FLAG) { resolveFingerspelling({ [key]: value }); return; }
  if (key === STARTER_OUTPUT_FLAG) { resolveStarterOutput({ ...env, [key]: value }); return; }
  if (key === "NEXT_PUBLIC_SIGNRELAY_PROFILE") {
    if (value && !PROFILES.has(value)) throw new Error(`Unknown build profile ${value}; use full, asl-demo or rehearsal.`);
    return;
  }
  if (value && !/^G-[A-Z0-9]{6,20}$/.test(value)) throw new Error("Invalid Google Analytics measurement ID (value omitted).");
}
for (const [key, value] of Object.entries(env)) validate(key, value);
for (const name of (await readdir(".")).filter(name => /^\.env(?:\.|$)/.test(name))) {
  for (const line of (await readFile(name, "utf8")).split("\n")) {
    const match = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    // Research switches must be visible to every build step, and deliberate:
    // never from a file that Next would read but the export scripts would not.
    if (match && [STARTER_OUTPUT_FLAG, "SIGNRELAY_RESEARCH_EXPORT", "SIGNRELAY_INCLUDE_PRIVATE_CAPTURE"].includes(match[1]))
      throw new Error(`${match[1]} is set in ${name}. Research output switches must be set on the build command, never in a .env file.`);
    if (match?.[1] === FINGERSPELLING_FLAG)
      throw new Error(`${FINGERSPELLING_FLAG} is set in ${name}. Next would inline it but the export scripts would not see it; set it on the build command instead.`);
    if (match) {
      const value = match[2].replace(/^['"]|['"]$/g, "");
      if (env.VERCEL_ENV && match[1] === "NEXT_PUBLIC_SIGNRELAY_PROFILE")
        throw new Error(`Set the hosted build profile on the build command, never in ${name}.`);
      validate(match[1], value);
    }
  }
}
assertReleaseSafe(env);
// A fresh export prevents removed assets or obsolete chunks from being deployed.
await rm("out", { recursive: true, force: true });
