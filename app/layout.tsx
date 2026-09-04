import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://signrelay.web.app"),
  title: {
    default: "SignRelay",
    template: "%s · SignRelay",
  },
  description:
    "A privacy-first, on-device sign-language recognition research platform for clear, respectful communication.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "SignRelay",
    description: "Sign freely. Be understood.",
    type: "website", url: "/", siteName: "SignRelay", images: [{ url: "/signrelay-social.png", width: 1200, height: 630, alt: "SignRelay — private, on-device sign-language recognition" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "SignRelay",
    description: "Private, on-device sign-language recognition research.",
    images: ["/signrelay-social.png"],
  },
  icons: {
    icon: "/signrelay-logo.png",
    shortcut: "/signrelay-logo.png",
    apple: "/signrelay-logo.png",
  },
  robots: { index: true, follow: true },
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
          logo: "https://signrelay.web.app/favicon.svg", sameAs: ["https://github.com/adamjamiesimson/SignRelay"],
        }) }} />
        {children}
      </body>
    </html>
  );
}
