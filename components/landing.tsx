"use client";

import Link from "next/link";
import { ArrowRight, Camera, Languages, LockKeyhole, MessageSquareText, Scale, Code } from "lucide-react";
import { MODEL_ADAPTERS, type LanguageId } from "@/lib/model-adapters";
import { HeroPreview } from "./hero-preview";
import { LanguagePicker } from "./language-picker";

type Props = {
  selected: LanguageId;
  onSelect: (language: LanguageId) => unknown;
  onStart: () => void;
};

const STEPS = [
  { icon: Languages, title: "Choose a language", body: "Seven sign languages recognise a built-in vocabulary. The rest learn from signs you teach." },
  { icon: Camera, title: "Sign to your camera", body: "Turn the camera on when you are ready. Video is analysed in this browser and never uploaded." },
  { icon: MessageSquareText, title: "Keep the words you mean", body: "Only confirmed words reach the transcript. Edit, copy or have them spoken aloud." },
];

const PRINCIPLES = [
  { icon: LockKeyhole, title: "Private by design", body: "Camera frames are processed on your device. Personal signs and transcripts stay in your browser until you delete them." },
  { icon: Scale, title: "Honest about limits", body: "SignRelay recognises isolated signs, not full sentences. Every model is a research preview, and uncertain movement adds nothing." },
  { icon: Code, title: "Public source code", body: "The code, model sources and known limitations are published on GitHub, so every claim can be checked." },
];

export function Landing({ selected, onSelect, onStart }: Props) {
  const language = MODEL_ADAPTERS[selected];
  return (
    <div className="landing">
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-copy">
          <p className="pill"><span className="pill-dot" aria-hidden="true" />Research preview · Runs in your browser</p>
          <h1 id="hero-title">Every sign deserves to be understood.</h1>
          <p className="lead">SignRelay turns supported signs into words you can read, edit and speak. Your camera video is analysed on this device and never uploaded.</p>
          <div className="hero-actions">
            <button type="button" className="button primary large" onClick={onStart}>Start signing</button>
            <a className="button ghost large" href="#how-it-works">How it works</a>
          </div>
          <p className="hero-meta">Free to use · No account · Not a substitute for an interpreter</p>
        </div>
        <HeroPreview />
      </section>

      <section className="section" id="how-it-works" aria-labelledby="steps-title">
        <div className="section-heading">
          <h2 id="steps-title">Three steps. No account.</h2>
          <Link className="text-link" href="/how-it-works">The full pipeline <ArrowRight aria-hidden="true" size={16} /></Link>
        </div>
        <ol className="steps">
          {STEPS.map(({ icon: Icon, title, body }, index) => (
            <li className="card step" key={title}>
              <span className="step-icon" aria-hidden="true"><Icon size={20} /></span>
              <span className="step-number">Step {index + 1}</span>
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
            <p>Pick the sign language you will use. You can switch at any time.</p>
          </div>
          <Link className="text-link" href="/languages">Compare languages <ArrowRight aria-hidden="true" size={16} /></Link>
        </div>
        <LanguagePicker selected={selected} onSelect={onSelect} />
        <div className="language-continue">
          <p><span>Selected</span> <strong>{language.shortName}</strong> · {language.language}</p>
          <button type="button" className="button primary" onClick={onStart}>Open {language.shortName} workspace <ArrowRight aria-hidden="true" size={16} /></button>
        </div>
      </section>

      <section className="section" aria-labelledby="principles-title">
        <h2 id="principles-title" className="section-title">Built with care</h2>
        <div className="principles">
          {PRINCIPLES.map(({ icon: Icon, title, body }) => (
            <article className="principle" key={title}>
              <Icon aria-hidden="true" size={20} />
              <h3>{title}</h3>
              <p>{body}</p>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
