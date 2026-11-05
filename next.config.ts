import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD } from "next/constants";
import { assertReleaseSafe, resolveFingerspelling, resolveStarterOutput } from "./lib/release-flags.mjs";

// A function of the phase so research fingerspelling defaults on only for the
// `next dev` server (never from NODE_ENV; lib/release-flags.mjs).
const nextConfig = (phase: string): NextConfig => {
  if (phase === PHASE_PRODUCTION_BUILD) assertReleaseSafe(process.env);
  return {
    output: "export",
    productionBrowserSourceMaps: false,
    poweredByHeader: false,
    compress: true,
    devIndicators: false,
    allowedDevOrigins: ["terminal.local"],
    // Inline the profile to remove the rehearsal hook from other builds.
    // scripts/prepare-export.mjs rejects unknown profiles.
    env: {
      NEXT_PUBLIC_SIGNRELAY_PROFILE: process.env.NEXT_PUBLIC_SIGNRELAY_PROFILE || "full",
      NEXT_PUBLIC_SIGNRELAY_FINGERSPELLING: resolveFingerspelling(process.env, { devServer: phase === PHASE_DEVELOPMENT_SERVER }),
      NEXT_PUBLIC_SIGNRELAY_STARTER_OUTPUT: resolveStarterOutput(process.env),
    },
  };
};

export default nextConfig;
