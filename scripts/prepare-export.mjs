import { readdir, readFile, rm } from "node:fs/promises";

const publicKeys = new Set(["NEXT_PUBLIC_GA_MEASUREMENT_ID", "NEXT_PUBLIC_SIGNRELAY_PROFILE"]);
const PROFILES = new Set(["full", "asl-demo", "rehearsal"]);
function validate(key, value) {
  if (!key.startsWith("NEXT_PUBLIC_")) return;
  if (!publicKeys.has(key)) throw new Error(`Unsupported public environment variable: ${key}. Never expose credentials through NEXT_PUBLIC_.`);
  if (key === "NEXT_PUBLIC_SIGNRELAY_PROFILE") {
    if (value && !PROFILES.has(value)) throw new Error(`Unknown build profile ${value}; use full, asl-demo or rehearsal.`);
    return;
  }
  if (value && !/^G-[A-Z0-9]{6,20}$/.test(value)) throw new Error("Invalid Google Analytics measurement ID (value omitted).");
}
for (const [key, value] of Object.entries(process.env)) validate(key, value);
for (const name of (await readdir(".")).filter(name => /^\.env(?:\.|$)/.test(name))) {
  for (const line of (await readFile(name, "utf8")).split("\n")) {
    const match = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match) validate(match[1], match[2].replace(/^['"]|['"]$/g, ""));
  }
}
// A fresh export prevents removed assets or obsolete chunks from being deployed.
await rm("out", { recursive: true, force: true });
