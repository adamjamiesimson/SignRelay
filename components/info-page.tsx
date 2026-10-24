import type { ReactNode } from "react";
import { SiteFooter, SiteHeader } from "./site-chrome";

export type InfoSection = {
  title: string;
  /** Anchor for links into the section; derived from the title when omitted. */
  id?: string;
  body: ReactNode;
};

const anchor = (section: InfoSection) => section.id ?? section.title.toLocaleLowerCase("en").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function InfoPage({
  eyebrow,
  title,
  intro,
  sections,
  note,
}: {
  eyebrow: string;
  title: string;
  intro: ReactNode;
  sections: InfoSection[];
  /** Shown under the introduction, e.g. a review or effective-date notice. */
  note?: ReactNode;
}) {
  const contents = sections.length >= 5;
  return (
    <div className="app-shell">
      <SiteHeader />
      <main className="info-page" id="main">
        <header className="info-hero">
          <p className="eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <div className="lead">{intro}</div>
          {note}
        </header>
        <div className={`info-layout${contents ? " with-contents" : ""}`}>
          {contents && (
            <nav className="info-contents" aria-label="On this page">
              <p>On this page</p>
              <ol>{sections.map(section => <li key={anchor(section)}><a href={`#${anchor(section)}`}>{section.title}</a></li>)}</ol>
            </nav>
          )}
          <div className="info-sections">
            {sections.map((section) => (
              <section className="info-section" key={anchor(section)} id={anchor(section)} aria-labelledby={`${anchor(section)}-title`}>
                <h2 id={`${anchor(section)}-title`}>{section.title}</h2>
                <div className="info-body">{section.body}</div>
              </section>
            ))}
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
