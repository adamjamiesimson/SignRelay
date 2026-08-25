import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "SignRelay",
    template: "%s · SignRelay",
  },
  description:
    "A privacy-first research platform for translating continuous sign language into text and speech.",
  openGraph: {
    title: "SignRelay",
    description: "Sign freely. Be understood.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "SignRelay",
    description: "Sign freely. Be understood.",
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
