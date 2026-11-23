import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "@/components/site-chrome";
import { LanguageDirectory } from "@/components/language-directory";

export const metadata: Metadata = {
  title: "Supported languages",
  description: "Which sign languages SignRelay recognises automatically, and which use only signs you teach.",
  alternates: { canonical: "/languages" },
};

export default function LanguagesPage() {
  return (
    <div className="app-shell">
      <SiteHeader />
      <main className="info-page" id="main">
        <header className="info-hero">
          <p className="eyebrow">Language support</p>
          <h1>Sign languages in SignRelay</h1>
          <p className="lead">Seven sign languages have experimental automatic recognition for a built-in vocabulary. Every other workspace recognises only the signs you teach it, privately on your device.</p>
        </header>
        <div className="info-layout">
          <LanguageDirectory />
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
