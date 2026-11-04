/** Inlined at build time from lib/release-flags.mjs via next.config.ts. A
 * literal comparison lets the bundler drop disabled branches. */
export const FINGERSPELLING_ENABLED = process.env.NEXT_PUBLIC_SIGNRELAY_FINGERSPELLING === "on";

/** "suggest": starter-rule words must be added by a person; "auto": a
 * non-public research export only (lib/release-flags.mjs fails closed). Any
 * value other than the literal "auto" means "suggest". */
export const STARTER_OUTPUT: "auto" | "suggest" = process.env.NEXT_PUBLIC_SIGNRELAY_STARTER_OUTPUT === "auto" ? "auto" : "suggest";

/** The policy actually applied in the browser. A research export opened from a
 * public address (not this device, a .local name or a private network address)
 * falls back to suggestions, so one uploaded by mistake still never inserts
 * unvalidated words. */
export function effectiveStarterOutput(compiled: "auto" | "suggest", hostname: string): "auto" | "suggest" {
  return compiled === "auto" && isPrivateHost(hostname) ? "auto" : "suggest";
}

export function isPrivateHost(hostname: string): boolean {
  const host = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host === "::1") return true;
  const ip = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ip) return false;
  const [a, b] = [Number(ip[1]), Number(ip[2])];
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}
