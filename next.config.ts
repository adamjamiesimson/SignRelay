import type { NextConfig } from "next";

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
  env: { NEXT_PUBLIC_SIGNRELAY_PROFILE: process.env.NEXT_PUBLIC_SIGNRELAY_PROFILE || "full" },
};

export default nextConfig;
