import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://signbridge-live.jena24.chatgpt.site"),
  title: {
    default: "SignBridge",
    template: "%s · SignBridge",
  },
  description:
    "A privacy-first research platform for translating continuous sign language into text and speech.",
  openGraph: {
    title: "SignBridge",
    description: "Sign freely. Be understood.",
    type: "website",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "SignBridge — Sign freely. Be understood." }],
  },
  twitter: {
    card: "summary_large_image",
    title: "SignBridge",
    description: "Sign freely. Be understood.",
    images: ["/og.png"],
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
