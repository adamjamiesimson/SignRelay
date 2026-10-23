"use client";

import { useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Check, Search } from "lucide-react";
import { ASL_ONLY, OUT_OF_PROFILE_LABEL, isLanguageAvailable } from "@/lib/build-profile";
import { LANGUAGE_LIST, MODEL_ADAPTERS, type LanguageId, type ModelAdapter } from "@/lib/model-adapters";

/** The seven workspaces with an installed shared model, in display order. */
export const AUTOMATIC_IDS: LanguageId[] = ["asl", "bsl", "isl", "lse", "rsl", "bdsl", "psl"];
const TAUGHT = LANGUAGE_LIST.filter(language => language.status !== "experimental");

/** What each automatic workspace actually has; never a quality claim. */
export function vocabularyLabel(language: ModelAdapter) {
  if (language.id === "rsl") return "1,000 classes";
  if (language.id === "bdsl") return "401 classes";
  if (language.id === "psl") return "775 reference signs";
  return `${language.automaticVocabularyCount.toLocaleString("en")} signs`;
}
export function modeLabel(language: ModelAdapter) {
  if (language.id === "rsl" || language.id === "bdsl") return "One sign at a time";
  if (language.id === "psl") return "Reference matching";
  return "Live";
}

const normalise = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("en");
const matches = (language: ModelAdapter, query: string) => !query || normalise(`${language.shortName} ${language.language}`).includes(query);

type Props = { selected: LanguageId; onSelect: (language: LanguageId) => unknown };

/** Two radio groups sharing one selection: languages with experimental
 * automatic recognition, and those that use only signs a person teaches. */
export function LanguagePicker({ selected, onSelect }: Props) {
  const [query, setQuery] = useState("");
  const [showTaught, setShowTaught] = useState(false);
  const search = normalise(query.trim());
  const automatic = useMemo(() => AUTOMATIC_IDS.map(id => MODEL_ADAPTERS[id]).filter(language => matches(language, search)), [search]);
  const taught = useMemo(() => TAUGHT.filter(language => matches(language, search)), [search]);
  const taughtSelected = TAUGHT.some(language => language.id === selected);
  const taughtVisible = search !== "" || showTaught || taughtSelected;

  return (
    <div className="language-picker">
      <label className="search-field">
        <Search aria-hidden="true" size={18} />
        <span className="sr-only">Search sign languages</span>
        <input type="search" value={query} onChange={event => setQuery(event.target.value)}
          placeholder={`Search ${LANGUAGE_LIST.length} sign languages`} autoComplete="off" spellCheck={false} />
      </label>
      {ASL_ONLY && <p className="notice compact" role="note"><strong>ASL demo build.</strong> Only the ASL workspace is included; other languages are listed for reference.</p>}

      <section className="language-group" aria-labelledby="automatic-heading">
        <div className="language-group-heading">
          <h3 id="automatic-heading">Automatic recognition</h3>
          <span className="tag">Experimental</span>
          <p>A built-in vocabulary is recognised with no setup. Results are research previews; check every word.</p>
        </div>
        {automatic.length > 0 && (
          <RadioGroup className="language-row" label="Sign languages with automatic recognition" items={automatic} selected={selected} onSelect={onSelect}
            render={language => <>
              <span className="language-card-head"><strong>{language.shortName}</strong>{selected === language.id && <Check aria-hidden="true" size={16} />}</span>
              <span className="language-card-name">{language.language}</span>
              {isLanguageAvailable(language.id)
                ? <span className="language-card-meta"><span>{vocabularyLabel(language)}</span><span>{modeLabel(language)}</span></span>
                : <span className="language-card-meta">{OUT_OF_PROFILE_LABEL}</span>}
            </>} />
        )}
      </section>

      <section className="language-group" aria-labelledby="taught-heading">
        <div className="language-group-heading">
          <h3 id="taught-heading">Teach your own signs</h3>
          <span className="tag muted">No automatic model</span>
          <p>Nothing is recognised until you record examples of the signs you use. They stay on this device.</p>
        </div>
        {taughtVisible ? (
          taught.length > 0 && <RadioGroup className="language-list" label="Sign languages that use signs you teach" items={taught} selected={selected} onSelect={onSelect}
            render={language => <>
              <strong>{language.shortName}</strong>
              <span>{language.language}{isLanguageAvailable(language.id) ? "" : ` · ${OUT_OF_PROFILE_LABEL}`}</span>
            </>} />
        ) : (
          <button type="button" className="button ghost small" onClick={() => setShowTaught(true)}>
            Show {TAUGHT.length} more languages
          </button>
        )}
      </section>
      {search && !automatic.length && !taught.length && (
        <p className="empty-state" role="status">No sign language matches “{query.trim()}”.</p>
      )}
    </div>
  );
}

function RadioGroup({ className, label, items, selected, onSelect, render }: Props & {
  className: string; label: string; items: ModelAdapter[]; render: (language: ModelAdapter) => ReactNode;
}) {
  const refs = useRef(new Map<LanguageId, HTMLButtonElement>());
  const enabled = items.filter(language => isLanguageAvailable(language.id));
  // One tab stop per group: the checked radio, or the first one that can be chosen.
  const focusable = enabled.find(language => language.id === selected)?.id ?? enabled[0]?.id;
  const move = (event: KeyboardEvent, from: LanguageId) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!step && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const index = enabled.findIndex(language => language.id === from);
    const next = event.key === "Home" ? enabled[0] : event.key === "End" ? enabled.at(-1)
      : enabled[(index + step! + enabled.length) % enabled.length];
    if (!next) return;
    refs.current.get(next.id)?.focus();
    onSelect(next.id);
  };
  return (
    <div className={className} role="radiogroup" aria-label={label}>
      {items.map(language => {
        const available = isLanguageAvailable(language.id);
        return (
          <button key={language.id} type="button" role="radio" aria-checked={selected === language.id}
            ref={node => { if (node) refs.current.set(language.id, node); else refs.current.delete(language.id); }}
            className={selected === language.id ? "selected" : ""} tabIndex={language.id === focusable ? 0 : -1}
            disabled={!available} aria-disabled={!available} onClick={() => onSelect(language.id)} onKeyDown={event => move(event, language.id)}>
            {render(language)}
          </button>
        );
      })}
    </div>
  );
}
