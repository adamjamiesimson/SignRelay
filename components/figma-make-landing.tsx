"use client";

import {
  ArrowRight,
  Check,
  Cpu,
  Hand,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import {
  LANGUAGE_LIST,
  MODEL_ADAPTERS,
  type LanguageId,
} from "@/lib/model-adapters";

const AUTOMATIC_IDS: LanguageId[] = ["asl", "bsl", "isl", "lse", "rsl", "bdsl", "psl"];
const automaticLanguages = AUTOMATIC_IDS.map((id) => MODEL_ADAPTERS[id]);

type Props = {
  selected: LanguageId;
  onSelect: (language: LanguageId) => void;
  onStart: () => void;
};

function HeroPreview() {
  return (
    <div className="figma-preview-card" aria-hidden="true">
      <div className="figma-preview-camera">
        <div className="figma-preview-hud">
          <span><i /> LIVE · ASL</span>
          <strong>RECOGNIZING</strong>
        </div>
        <div className="figma-corner figma-corner-tl" />
        <div className="figma-corner figma-corner-tr" />
        <div className="figma-corner figma-corner-bl" />
        <div className="figma-corner figma-corner-br" />
        <span className="figma-sign-chip">HELLO</span>
        <span className="figma-preview-confidence">96%</span>
      </div>
      <div className="figma-tracking-row">
        <span><i className="face" /> Face</span>
        <span><i className="shoulder" /> Shoulders</span>
        <span><i className="hands" /> Hands (2)</span>
      </div>
      <div className="figma-preview-output">
        <div className="figma-preview-output-label">
          <span>Translation</span>
          <strong>96% confidence</strong>
        </div>
        <h3>Hello</h3>
        <div className="figma-confidence-track"><span /></div>
        <div className="figma-sentence-preview">Hello <i /></div>
      </div>
    </div>
  );
}

function HowItWorks({ onStart }: { onStart: () => void }) {
  const steps = [
    {
      num: "01",
      icon: <UserRound size={18} />,
      title: "Allow camera access",
      body: "SignRelay uses your device camera to observe signing. Camera frames are analysed locally in your browser and are not uploaded.",
    },
    {
      num: "02",
      icon: <Cpu size={18} />,
      title: "Select your sign language",
      body: "Choose from seven automatic research recognizers, with additional language workspaces available for private signer-taught vocabulary.",
    },
    {
      num: "03",
      icon: <Check size={18} />,
      title: "Sign naturally",
      body: "The recognition pipeline tracks hands, face and upper-body landmarks and returns isolated-sign predictions when confidence is high enough.",
    },
  ];

  return (
    <section className="figma-how-section" id="how-it-works">
      <div className="figma-section-inner figma-how-grid">
        <div className="figma-how-copy">
          <span className="figma-eyebrow">How it works</span>
          <h2>Recognition built<br />for real conversations</h2>
          <p>Computer vision meets local model inference, with the camera remaining on your device.</p>
          <button className="figma-text-link" onClick={onStart}>Try the translator <ArrowRight size={13} /></button>
        </div>
        <div className="figma-step-list">
          {steps.map((step) => (
            <article className="figma-step" key={step.num}>
              <div className="figma-step-icon">{step.icon}</div>
              <div>
                <span>{step.num}</span>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function Languages({ selected, onSelect }: Pick<Props, "selected" | "onSelect">) {
  return (
    <section className="figma-language-section" id="languages">
      <div className="figma-section-inner">
        <div className="figma-language-heading">
          <div>
            <h2>Supported languages</h2>
            <p>7 automatic research recognizers · {LANGUAGE_LIST.length} total workspaces</p>
          </div>
          <a href="/languages">View all <ArrowRight size={13} /></a>
        </div>
        <div className="figma-language-row" role="radiogroup" aria-label="Automatic sign languages">
          {automaticLanguages.map((language) => (
            <button
              key={language.id}
              className={selected === language.id ? "selected" : ""}
              onClick={() => onSelect(language.id)}
              role="radio"
              aria-checked={selected === language.id}
            >
              <div>
                <strong>{language.shortName}</strong>
                <span>LIVE</span>
              </div>
              <small>{language.language}</small>
              <div className="figma-language-meter">
                <i style={{ width: language.id === "asl" ? "94%" : language.id === "bsl" ? "88%" : language.id === "isl" ? "82%" : language.id === "lse" ? "72%" : language.id === "rsl" ? "78%" : language.id === "bdsl" ? "70%" : "68%" }} />
              </div>
              <em>{language.id === "rsl" ? "1,000 classes" : language.id === "bdsl" ? "401 classes" : language.id === "psl" ? "775 signs" : language.automaticVocabularyCount.toLocaleString() + " classes"}</em>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function Philosophy() {
  return (
    <section className="figma-philosophy-section">
      <div className="figma-section-inner figma-philosophy-grid">
        <article>
          <div className="figma-philosophy-icon"><ShieldCheck size={18} /></div>
          <h3>Privacy first</h3>
          <p>Recognition runs locally in your browser. Camera frames never leave your device and raw video is not stored by SignRelay.</p>
        </article>
        <article>
          <div className="figma-philosophy-icon"><Hand size={18} /></div>
          <h3>Open source</h3>
          <p>SignRelay is open source and its recognition approach, model status and language limitations are documented publicly.</p>
        </article>
      </div>
    </section>
  );
}

export function FigmaMakeLanding({ selected, onSelect, onStart }: Props) {
  return (
    <div className="figma-landing">
      <section className="figma-hero">
        <div className="figma-hero-glow" />
        <div className="figma-hero-inner">
          <div className="figma-hero-copy">
            <h1>Sign freely.<br /><span>Connect<br />naturally.</span></h1>
            <p>SignRelay recognizes supported sign language through your camera. Seven sign languages currently include automatic research recognition, with processing kept in your browser.</p>
            <div className="figma-hero-actions">
              <button className="figma-primary" onClick={onStart}>Start translating <ArrowRight size={15} /></button>
              <a className="figma-secondary" href="#languages">Explore languages</a>
            </div>
            <div className="figma-hero-stats">
              <div><strong>7</strong><span>Automatic languages</span><small>Research recognition</small></div>
              <div><strong>40</strong><span>Workspaces</span><small>Language-scoped</small></div>
              <div><strong>Local</strong><span>Processing</span><small>Camera stays on-device</small></div>
            </div>
          </div>
          <div className="figma-hero-preview"><HeroPreview /></div>
        </div>
      </section>

      <HowItWorks onStart={onStart} />
      <Languages selected={selected} onSelect={onSelect} />
      <Philosophy />

      <section className="figma-final-cta">
        <div className="figma-section-inner">
          <div className="figma-final-card">
            <h2>Communication without<br />barriers.</h2>
            <p>SignRelay is free and open source. No account required. Start recognizing supported signs from your camera in seconds.</p>
            <div>
              <button className="figma-primary" onClick={onStart}>Start translating <ArrowRight size={15} /></button>
              <a className="figma-secondary" href="/languages">Explore languages</a>
            </div>
            <small>Open source · No account required · Research preview</small>
          </div>
        </div>
      </section>
    </div>
  );
}
