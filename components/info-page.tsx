import type { ReactNode } from "react";
import { SiteFooter, SiteHeader } from "./site-chrome";

export type InfoSection = {
  title: string;
  body: ReactNode;
};

export function InfoPage({
  eyebrow,
  title,
  intro,
  sections,
}: {
  eyebrow: string;
  title: string;
  intro: string;
  sections: InfoSection[];
}) {
  return (
    <div className="app-shell">
      <SiteHeader />
      <main className="info-page">
        <header className="info-hero">
          <p className="eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <p>{intro}</p>
        </header>
        <div className="info-sections">
          {sections.map((section, index) => (
            <section className="info-section" key={section.title}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <div>
                <h2>{section.title}</h2>
                <div className="info-body">{section.body}</div>
              </div>
            </section>
          ))}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
