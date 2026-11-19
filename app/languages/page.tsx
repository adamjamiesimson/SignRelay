import type { Metadata } from "next";
import Link from "next/link";
import { PUBLIC_LANGUAGE_LIST } from "@/lib/model-adapters";
import { ASL_ONLY } from "@/lib/build-profile";
import { SiteFooter, SiteHeader } from "@/components/site-chrome";

export const metadata: Metadata = {
  title: "Supported languages",
  description: "Seven experimental sign-language recognition workspaces with built-in models or reference matching. Isolated signs only.",
  alternates: { canonical: "/languages" },
};

export default function LanguagesPage() {
  const automatic = PUBLIC_LANGUAGE_LIST;

  return (
    <div className="app-shell figma-app">
      <SiteHeader />
      <main className="figma-language-page">
        <section className="figma-language-page-hero">
          <div className="figma-section-inner">
            <span className="figma-eyebrow">Language support</span>
            <h1>Supported sign languages</h1>
            <p>Only the seven languages with built-in automatic recognition are listed. Each is an experimental isolated-sign recognizer, not a validated full-conversation translator.</p>
            {ASL_ONLY && <p role="note"><strong>ASL demo build:</strong> only the ASL workspace is included. The other languages below are listed for information; their models are not part of this build.</p>}
            <div className="figma-language-summary" aria-label="Language support summary">
              <div><strong>{automatic.length}</strong><span>Automatic</span></div>
            </div>
          </div>
        </section>

        <section className="figma-language-page-section">
          <div className="figma-section-inner">
            <div className="figma-language-page-heading">
              <div><i className="automatic" /><h2>Automatic research recognition</h2><span>({automatic.length})</span></div>
              <p>Separate, language-specific recognition pipelines. These are research previews, not unrestricted continuous interpretation.</p>
            </div>
            <div className="figma-language-page-grid">
              {automatic.map((language) => (
                <article className="figma-language-page-card automatic" key={language.id}>
                  <div className="figma-language-page-card-head">
                    <div><strong>{language.shortName}</strong><span>{language.language}</span></div>
                    <em className="beta-badge" title="Experimental automatic recognition; live accuracy is not fully validated"><span aria-hidden="true">β</span>Beta</em>
                  </div>
                  <p>{language.summary}</p>
                  <div className="figma-language-page-meta">
                    <span>{language.id === "rsl" ? "967 words/phrases + 33 letters" : language.id === "psl" ? "775 dictionary signs" : `${language.automaticVocabularyCount.toLocaleString()} automatic classes`}</span>
                    <span>{language.version}</span>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="figma-language-page-cta">
          <div className="figma-section-inner">
            <div className="figma-final-card">
              <h2>Choose a supported language and try isolated-sign recognition.</h2>
              <p>Select one of seven research recognition modes. Accuracy varies; continuous sentence translation is not supported yet.</p>
              <div><Link className="figma-primary" href="/#choose-language">Start translating</Link></div>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
