import type { Metadata } from "next";
import Link from "next/link";
import { LANGUAGE_LIST } from "@/lib/model-adapters";
import { SiteFooter, SiteHeader } from "@/components/site-chrome";

export const metadata: Metadata = {
  title: "Supported languages",
  description: "Automatic research recognizers and private signer-taught workspaces in SignRelay.",
  alternates: { canonical: "/languages" },
};

export default function LanguagesPage() {
  const automatic = LANGUAGE_LIST.filter((language) => language.status === "experimental");
  const preparing = LANGUAGE_LIST.filter((language) => language.status === "preparing");
  const personal = LANGUAGE_LIST.filter((language) => language.status === "personal");

  return (
    <div className="app-shell figma-app">
      <SiteHeader />
      <main className="figma-language-page">
        <section className="figma-language-page-hero">
          <div className="figma-section-inner">
            <span className="figma-eyebrow">Language support</span>
            <h1>Supported sign languages</h1>
            <p>Seven language workspaces currently include automatic research recognition. The remaining workspaces support private signer-taught recognition on your device.</p>
            <div className="figma-language-summary" aria-label="Language support summary">
              <div><strong>{automatic.length}</strong><span>Automatic</span></div>
              <div><strong>{personal.length}</strong><span>Signer-taught</span></div>
              <div><strong>{preparing.length}</strong><span>Preparing</span></div>
              <div><strong>{LANGUAGE_LIST.length}</strong><span>Total workspaces</span></div>
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
                    <em>AUTO</em>
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

        {preparing.length > 0 && (
          <section className="figma-language-page-section">
            <div className="figma-section-inner">
              <div className="figma-language-page-heading">
                <div><i className="preparing" /><h2>Models in preparation</h2><span>({preparing.length})</span></div>
                <p>The workspace is usable for personal signer-taught signs while the shared automatic model is still being prepared.</p>
              </div>
              <div className="figma-language-page-grid">
                {preparing.map((language) => (
                  <article className="figma-language-page-card preparing" key={language.id}>
                    <div className="figma-language-page-card-head">
                      <div><strong>{language.shortName}</strong><span>{language.language}</span></div>
                      <em>PREPARING</em>
                    </div>
                    <p>{language.summary}</p>
                  </article>
                ))}
              </div>
            </div>
          </section>
        )}

        <section className="figma-language-page-section">
          <div className="figma-section-inner">
            <div className="figma-language-page-heading">
              <div><i className="personal" /><h2>Signer-taught workspaces</h2><span>({personal.length})</span></div>
              <p>These workspaces recognize only the examples the signer records locally. They are not presented as pretrained language models.</p>
            </div>
            <div className="figma-language-page-grid personal-grid">
              {personal.map((language) => (
                <article className="figma-language-page-card personal" key={language.id}>
                  <div className="figma-language-page-card-head">
                    <div><strong>{language.shortName}</strong><span>{language.language}</span></div>
                    <em>PERSONAL</em>
                  </div>
                  <p>{language.summary}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="figma-language-page-cta">
          <div className="figma-section-inner">
            <div className="figma-final-card">
              <h2>Choose a language and start signing.</h2>
              <p>Open the translator, select a workspace, and keep your camera processing in the browser.</p>
              <div><Link className="figma-primary" href="/#choose-language">Start translating</Link></div>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
