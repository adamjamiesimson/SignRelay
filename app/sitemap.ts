import type { MetadataRoute } from "next";
export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const pages = ["", "/how-it-works", "/languages", "/models", "/privacy", "/about", "/roadmap"];
  return pages.map((path) => ({ url: `https://signrelay.web.app${path}`, lastModified: new Date(), changeFrequency: "monthly", priority: path ? 0.7 : 1 }));
}
