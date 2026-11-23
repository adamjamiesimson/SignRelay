import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./site.css";
import "./workspace.css";
import { REHEARSAL, REHEARSAL_BANNER } from "@/lib/rehearsal";

export const metadata: Metadata = {
  metadataBase: new URL("https://signrelay.web.app"),
  title: {
    default: "SignRelay",
    template: "%s · SignRelay",
  },
  description:
    "SignRelay turns supported signs into words you can read, edit and speak. Camera video is analysed in your browser and never uploaded.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "SignRelay",
    description: "Every sign deserves to be understood.",
    type: "website", url: "/", siteName: "SignRelay", images: [{ url: "/signrelay-social-v2.png", width: 1200, height: 630, alt: "SignRelay, private on-device sign-language recognition" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "SignRelay",
    description: "Private, on-device sign-language recognition research.",
    images: ["/signrelay-social-v2.png"],
  },
  icons: {
    icon: { url: "/favicon.png?v=signrelay", type: "image/png" },
    shortcut: "/favicon.png?v=signrelay",
    apple: "/apple-touch-icon.png",
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#0a0c0e",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({
          "@context": "https://schema.org", "@type": "Organization", name: "SignRelay", url: "https://signrelay.web.app",
          description: "Privacy-first browser research platform for sign-language recognition.",
          logo: "https://signrelay.web.app/signrelay-mark.webp", sameAs: ["https://github.com/adamjamiesimson/SignRelay"],
        }) }} />
        <a className="skip-link" href="#main">Skip to content</a>
        {REHEARSAL && <div role="alert" className="rehearsal-banner" style={{ position: "sticky", top: 0, zIndex: 1000, padding: "8px 16px", background: "#7a1f1f", color: "#fff", fontWeight: 700, textAlign: "center" }}>{REHEARSAL_BANNER}</div>}
        {children}
      </body>
    </html>
  );
}
