import type { NextConfig } from "next";
import { resolveFingerspelling } from "./lib/release-flags.mjs";

const nextConfig: NextConfig = {
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
    NEXT_PUBLIC_SIGNRELAY_FINGERSPELLING: resolveFingerspelling() },
};

export default nextConfig;
