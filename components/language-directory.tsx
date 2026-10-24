"use client";

import { useMemo, useState } from "react";
import { ArrowRight, Search } from "lucide-react";
import { ASL_ONLY, OUT_OF_PROFILE_LABEL, isLanguageAvailable } from "@/lib/build-profile";
import { LANGUAGE_LIST, MODEL_ADAPTERS, type ModelAdapter } from "@/lib/model-adapters";
import { AUTOMATIC_IDS, LanguageStatus, vocabularyLabel } from "./language-picker";

const normalise = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("en");
const open = (language: ModelAdapter) => `/?lang=${language.id}#translator`;

export function LanguageDirectory() {
  const [query, setQuery] = useState("");
  const search = normalise(query.trim());
  const filter = useMemo(() => (language: ModelAdapter) => !search || normalise(`${language.shortName} ${language.language}`).includes(search), [search]);
  const automatic = AUTOMATIC_IDS.map(id => MODEL_ADAPTERS[id]).filter(filter);
  const preparing = LANGUAGE_LIST.filter(language => language.status === "preparing").filter(filter);
  const personal = LANGUAGE_LIST.filter(language => language.status === "personal").filter(filter);
  const counts = {
    automatic: AUTOMATIC_IDS.length,
    preparing: LANGUAGE_LIST.filter(language => language.status === "preparing").length,
    personal: LANGUAGE_LIST.filter(language => language.status === "personal").length,
  };

  return (
    <div className="directory">
      <div className="directory-summary" aria-label="Language support summary">
        <div><strong>{counts.automatic}</strong><span>Automatic recognition</span></div>
        <div><strong>{counts.preparing + counts.personal}</strong><span>Teach your own signs</span></div>
        <div><strong>{LANGUAGE_LIST.length}</strong><span>Workspaces in total</span></div>
      </div>
      <label className="search-field">
        <Search aria-hidden="true" size={18} />
        <span className="sr-only">Search sign languages</span>
        <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={`Search ${LANGUAGE_LIST.length} sign languages`} autoComplete="off" spellCheck={false} />
      </label>
      {ASL_ONLY && <p className="notice compact" role="note"><strong>ASL demo build:</strong> only the ASL workspace is included. The other languages are listed for information; their models are not part of this build.</p>}

      {automatic.length > 0 && (
        <section className="language-group" aria-labelledby="directory-automatic">
          <div className="language-group-heading">
            <h2 id="directory-automatic" className="section-title">Automatic recognition</h2>
            <span className="tag">Beta · Experimental</span>
            <p>Each has its own language-specific model or reference library. These are research previews for isolated signs, not continuous interpretation, and live-camera accuracy has not been measured.</p>
          </div>
          <div className="directory-grid">
            {automatic.map(language => (
              <article className="card directory-card" key={language.id}>
                <div className="directory-card-head">
                  <div><strong>{language.shortName}</strong><span>{language.language}</span></div>
                  <LanguageStatus language={language} />
                </div>
                <p>{language.summary}</p>
                <div className="directory-meta">
                  <span>{language.id === "rsl" ? "967 words/phrases + 33 letters" : vocabularyLabel(language)}</span>
                  <span>{language.version}</span>
                </div>
                {isLanguageAvailable(language.id)
                  ? <a className="text-link" href={open(language)}>Open {language.shortName} workspace <ArrowRight aria-hidden="true" size={16} /></a>
                  : <span className="field-hint">{OUT_OF_PROFILE_LABEL}</span>}
              </article>
            ))}
          </div>
        </section>
      )}

      {(preparing.length > 0 || personal.length > 0) && (
        <section className="language-group" aria-labelledby="directory-taught">
          <div className="language-group-heading">
            <h2 id="directory-taught" className="section-title">Teach your own signs</h2>
            <span className="tag muted">No automatic model</span>
            <p>No shared model is installed for these languages, so nothing is recognised until you record two or three examples of each sign you use. Examples stay on your device.{counts.preparing ? " “Model planned” means a dataset has been mapped for a future model; none is installed." : ""}</p>
          </div>
          <ul className="directory-compact">
            {[...preparing, ...personal].map(language => (
              <li key={language.id}>
                <div>
                  <strong>{language.shortName}</strong>
                  <span>{language.language}{language.status === "preparing" ? " · Model planned" : ""}</span>
                  <LanguageStatus language={language} />
                </div>
                {isLanguageAvailable(language.id)
                  ? <a className="button ghost small" href={open(language)} aria-label={`Open ${language.language} workspace`}>Open</a>
                  : <span className="field-hint">Not in this build</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {search && !automatic.length && !preparing.length && !personal.length && (
        <p className="empty-state" role="status">No sign language matches “{query.trim()}”.</p>
      )}
    </div>
  );
}
