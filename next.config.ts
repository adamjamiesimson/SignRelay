import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";
import { resolveFingerspelling, resolveStarterOutput } from "./lib/release-flags.mjs";

// A function of the phase so research fingerspelling defaults on only for the
// `next dev` server (never from NODE_ENV; lib/release-flags.mjs).
const nextConfig = (phase: string): NextConfig => ({
  output: "export",
  productionBrowserSourceMaps: false,
  poweredByHeader: false,
  compress: true,
  devIndicators: false,
  allowedDevOrigins: ["terminal.local"],
  // Always inline the build profile (default "full") so profile-only code,
  // such as the automated rehearsal hook, is removed from other builds rather
  // than shipped inert. scripts/prepare-export.mjs rejects unknown values.
  env: { NEXT_PUBLIC_SIGNRELAY_PROFILE: process.env.NEXT_PUBLIC_SIGNRELAY_PROFILE || "full",
    // Research fingerspelling is off unless the build opts in (lib/release-flags.mjs).
    NEXT_PUBLIC_SIGNRELAY_FINGERSPELLING: resolveFingerspelling(process.env, { devServer: phase === PHASE_DEVELOPMENT_SERVER }),
    // Starter-rule words are suggestions unless a research build opts in (lib/release-flags.mjs).
    NEXT_PUBLIC_SIGNRELAY_STARTER_OUTPUT: resolveStarterOutput(process.env) },
});

export default nextConfig;
