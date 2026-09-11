import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  productionBrowserSourceMaps: false,
  poweredByHeader: false,
  compress: true,
  devIndicators: false,
  allowedDevOrigins: ["terminal.local"],
};

export default nextConfig;
