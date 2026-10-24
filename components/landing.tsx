"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { MODEL_ADAPTERS, type LanguageId } from "@/lib/model-adapters";
import { HeroPreview } from "./hero-preview";
import { LanguagePicker } from "./language-picker";

type Props = {
  selected: LanguageId;
  onSelect: (language: LanguageId) => unknown;
  onStart: () => void;
};

const STEPS = [
  { title: "Choose a language", body: "Use an experimental model or teach your own signs." },
  { title: "Sign to your camera", body: "Video stays on your device." },
  { title: "Use your transcript", body: "Edit, copy or speak the recognized words." },
];

export function Landing({ selected, onSelect, onStart }: Props) {
  const language = MODEL_ADAPTERS[selected];
  return (
    <div className="landing">
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-copy">
          <h1 id="hero-title" aria-label="Every sign deserves to be understood."><em>Every sign</em>{" "}deserves to be <em>understood.</em></h1>
          <p className="lead">Turn signs into words you can read or speak. Camera video stays on your device.</p>
          <div className="hero-actions">
            <button type="button" className="button primary large" onClick={onStart}>Start signing</button>
            <a className="button ghost large" href="#how-it-works">How it works</a>
          </div>
        </div>
        <HeroPreview />
      </section>

      <section className="section" id="how-it-works" aria-labelledby="steps-title">
        <div className="section-heading">
          <h2 id="steps-title">How it works</h2>
        </div>
        <ol className="steps">
          {STEPS.map(({ title, body }) => (
            <li className="step" key={title}>
              <h3>{title}</h3>
              <p>{body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="section" id="languages" aria-labelledby="languages-title">
        <div className="section-heading">
          <div>
            <h2 id="languages-title">Choose your language</h2>
          </div>
          <Link className="text-link" href="/languages">Compare languages <ArrowRight aria-hidden="true" size={16} /></Link>
        </div>
        <LanguagePicker selected={selected} onSelect={onSelect} />
        <div className="language-continue">
          <button type="button" className="button primary" onClick={onStart}>Open {language.shortName} workspace <ArrowRight aria-hidden="true" size={16} /></button>
        </div>
      </section>

    </div>
  );
}
