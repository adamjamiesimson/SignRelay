"use client";

import { useEffect, useState } from "react";
import {
  LANGUAGE_LIST,
  MODEL_ADAPTERS,
  type LanguageId,
} from "@/lib/model-adapters";

const AUTOMATIC_IDS: LanguageId[] = ["asl", "bsl", "isl", "lse", "rsl", "bdsl", "psl"];
const automaticLanguages = AUTOMATIC_IDS.map((id) => MODEL_ADAPTERS[id]);

function capabilityWidth(language: (typeof automaticLanguages)[number]) {
  const count = language.automaticVocabularyCount || 0;
  return `${Math.max(28, Math.min(100, Math.round((count / 2000) * 100)))}%`;
}

type Props = {
  selected: LanguageId;
  onSelect: (language: LanguageId) => void;
  onStart: () => void;
};

const DEMO_SEQUENCE = [
  { sign: "HELLO", translation: "Hello", confidence: 96 },
  { sign: "HOW", translation: "How", confidence: 93 },
  { sign: "ARE", translation: "are", confidence: 91 },
  { sign: "YOU", translation: "you", confidence: 97 },
  { sign: "THANK YOU", translation: "Thank you", confidence: 94 },
  { sign: "PLEASE", translation: "Please", confidence: 90 },
  { sign: "UNDERSTAND", translation: "Understand", confidence: 88 },
];

type DemoTracking = {
  face: boolean;
  shoulders: boolean;
  hands: boolean;
  handCount: number;
};

function DemoTrackingOverlay({ tracking }: { tracking: DemoTracking }) {
  const faceDots = [
    [80, 26], [63, 35], [97, 35], [56, 48], [68, 50], [92, 50], [104, 48],
    [54, 62], [74, 62], [80, 61], [86, 62], [106, 62], [65, 78], [72, 79],
    [80, 82], [88, 79], [95, 78], [80, 92],
  ];
  const rightHand = [[122,186],[110,172],[103,162],[97,153],[92,146],[118,162],[116,149],[114,138],[113,128],[124,161],[124,148],[124,136],[124,126],[130,163],[131,150],[132,138],[133,128],[136,168],[138,157],[140,148],[141,140]];
  const leftHand = rightHand.map(([x,y]) => [160-x,y]);

  const handPaths = (points: number[][]) => (
    <>
      <path d={`M${points[0][0]} ${points[0][1]} L${points[1][0]} ${points[1][1]} L${points[2][0]} ${points[2][1]} L${points[3][0]} ${points[3][1]} L${points[4][0]} ${points[4][1]}`} />
      <path d={`M${points[0][0]} ${points[0][1]} L${points[5][0]} ${points[5][1]} L${points[6][0]} ${points[6][1]} L${points[7][0]} ${points[7][1]} L${points[8][0]} ${points[8][1]}`} />
      <path d={`M${points[0][0]} ${points[0][1]} L${points[9][0]} ${points[9][1]} L${points[10][0]} ${points[10][1]} L${points[11][0]} ${points[11][1]} L${points[12][0]} ${points[12][1]}`} />
      <path d={`M${points[0][0]} ${points[0][1]} L${points[13][0]} ${points[13][1]} L${points[14][0]} ${points[14][1]} L${points[15][0]} ${points[15][1]} L${points[16][0]} ${points[16][1]}`} />
      <path d={`M${points[0][0]} ${points[0][1]} L${points[17][0]} ${points[17][1]} L${points[18][0]} ${points[18][1]} L${points[19][0]} ${points[19][1]} L${points[20][0]} ${points[20][1]}`} />
      <path d={`M${points[1][0]} ${points[1][1]} L${points[5][0]} ${points[5][1]} L${points[9][0]} ${points[9][1]} L${points[13][0]} ${points[13][1]} L${points[17][0]} ${points[17][1]}`} />
    </>
  );

  return (
    <svg className="figma-demo-mesh" viewBox="0 0 160 220" aria-hidden="true">
      {tracking.shoulders && (
        <g className="figma-demo-shoulders">
          <path d="M32 116 L80 102 L128 116 M80 102 L80 135" />
          {[[32,116],[80,102],[128,116]].map(([x,y],i)=><circle key={i} cx={x} cy={y} r="2.7" />)}
        </g>
      )}
      {tracking.face && (
        <g className="figma-demo-face">
          <ellipse cx="80" cy="59" rx="31" ry="37" />
          <path d="M61 43 Q68 40 75 42 M85 42 Q92 40 99 43 M62 50 Q68 47 74 50 M86 50 Q92 47 98 50 M80 44 L78 56 L74 65 L80 61 M72 79 Q80 84 88 79" />
          {faceDots.map(([x,y],i)=><circle key={i} cx={x} cy={y} r="1.55" style={{animationDelay:`${i*45}ms`}} />)}
        </g>
      )}
      {tracking.hands && tracking.handCount >= 1 && (
        <g className="figma-demo-hand right">
          <path d="M128 116 L122 186" className="arm" />
          {handPaths(rightHand)}
          {rightHand.map(([x,y],i)=><circle key={i} cx={x} cy={y} r={i===0?2.4:1.55} style={{animationDelay:`${i*35}ms`}} />)}
        </g>
      )}
      {tracking.hands && tracking.handCount >= 2 && (
        <g className="figma-demo-hand left">
          <path d="M32 116 L38 186" className="arm" />
          {handPaths(leftHand)}
          {leftHand.map(([x,y],i)=><circle key={i} cx={x} cy={y} r={i===0?2.4:1.55} style={{animationDelay:`${(i+4)*35}ms`}} />)}
        </g>
      )}
    </svg>
  );
}

function HeroPreview() {
  const [idx, setIdx] = useState(0);
  const [phase, setPhase] = useState<"show" | "fade">("show");
  const [sentence, setSentence] = useState<string[]>(["Hello"]);
  const [tracking, setTracking] = useState<DemoTracking>({ face: false, shoulders: false, hands: false, handCount: 0 });
  const item = DEMO_SEQUENCE[idx];

  useEffect(() => {
    const t1 = window.setTimeout(() => setTracking((t) => ({ ...t, face: true, shoulders: true })), 800);
    const t2 = window.setTimeout(() => setTracking((t) => ({ ...t, hands: true, handCount: 1 })), 1300);
    const t3 = window.setTimeout(() => setTracking((t) => ({ ...t, handCount: 2 })), 1800);
    return () => { window.clearTimeout(t1); window.clearTimeout(t2); window.clearTimeout(t3); };
  }, []);

  useEffect(() => {
    let inner: number | undefined;
    const timer = window.setInterval(() => {
      setPhase("fade");
      inner = window.setTimeout(() => {
        setIdx((current) => {
          const next = (current + 1) % DEMO_SEQUENCE.length;
          setSentence((previous) => [...previous, DEMO_SEQUENCE[next].translation].slice(-5));
          setTracking((currentTracking) => ({
            ...currentTracking,
            handCount: next === 1 || next === 5 ? 1 : 2,
          }));
          return next;
        });
        setPhase("show");
      }, 280);
    }, 2600);
    return () => { window.clearInterval(timer); if (inner) window.clearTimeout(inner); };
  }, []);

  return (
    <div className="figma-preview-card figma-preview-floating" aria-label="Animated illustrative SignRelay recognition demo">
      <div className="figma-preview-camera">
        <div className="figma-preview-hud">
          <span><i /> LIVE · ASL</span>
          <strong>RECOGNIZING</strong>
        </div>
        <div className={`figma-preview-mesh-wrap ${phase}`}>
          <DemoTrackingOverlay tracking={tracking} />
        </div>
        <div className="figma-demo-scan-line" />
        <div className="figma-corner figma-corner-tl" />
        <div className="figma-corner figma-corner-tr" />
        <div className="figma-corner figma-corner-bl" />
        <div className="figma-corner figma-corner-br" />
        <span className={`figma-sign-chip ${phase}`}>{item.sign}</span>
        <span className={`figma-preview-confidence ${phase}`}>{item.confidence}%</span>
      </div>
      <div className="figma-tracking-row">
        <span className={tracking.face ? "active face" : ""}><i className="face" /> Face</span>
        <span className={tracking.shoulders ? "active shoulder" : ""}><i className="shoulder" /> Shoulders</span>
        <span className={tracking.hands ? "active hands" : ""}><i className="hands" /> Hands ({tracking.handCount})</span>
      </div>
      <div className="figma-preview-output">
        <div className="figma-preview-output-label">
          <span>Translation</span>
          <strong>{item.confidence}% confidence</strong>
        </div>
        <h3 className={phase}>{item.translation}</h3>
        <div className="figma-confidence-track"><span style={{ width: `${item.confidence}%` }} /></div>
        <div className="figma-sentence-preview">
          {sentence.map((word, index) => (
            <span key={`${index}-${word}`} className={index === sentence.length - 1 ? "current" : ""}>{word}</span>
          ))}
          <i />
        </div>
      </div>
    </div>
  );
}

function HowItWorks() {
  const steps = [
    {
      num: "01",
      title: "Allow camera access",
      body: "SignRelay uses your device camera to observe signing. Camera frames are analysed locally in your browser and are not uploaded.",
    },
    {
      num: "02",
      title: "Select your sign language",
      body: "Choose from seven automatic research recognizers, with additional language workspaces available while more models are in development.",
    },
    {
      num: "03",
      title: "Sign naturally",
      body: "The recognition pipeline tracks hands, face and upper-body landmarks and returns isolated-sign predictions when confidence is high enough.",
    },
  ];

  return (
    <section className="figma-how-section" id="how-it-works">
      <div className="figma-section-inner">
        <div className="figma-step-list figma-step-list-centered">
          {steps.map((step) => (
            <article className="figma-step" key={step.num}>
              <div>
                <span className="figma-step-number">{step.num}</span>
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
          <a href="/languages">View all languages</a>
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
                <span>AUTO</span>
              </div>
              <small>{language.language}</small>
              <div className="figma-language-meter" title="Relative automatic vocabulary size, not accuracy">
                <i style={{ width: capabilityWidth(language) }} />
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
          <span className="figma-philosophy-label">Your device</span>
          <h3>Privacy first</h3>
          <p>Recognition runs locally in your browser. Camera frames never leave your device and raw video is not stored by SignRelay.</p>
        </article>
        <article>
          <span className="figma-philosophy-label">Our approach</span>
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
              <button className="figma-primary" onClick={onStart}>Start translating</button>
              <a className="figma-secondary" href="#languages">Explore languages</a>
            </div>
            <div className="figma-hero-stats">
              <div><strong>7</strong><span>Automatic languages</span><small>Research recognition</small></div>
              <div><strong>Local</strong><span>Processing</span><small>Camera stays on-device</small></div>
            </div>
          </div>
          <div className="figma-hero-preview"><HeroPreview /></div>
        </div>
      </section>

      <HowItWorks />
      <Languages selected={selected} onSelect={onSelect} />
      <Philosophy />

      <section className="figma-final-cta">
        <div className="figma-section-inner">
          <div className="figma-final-card">
            <h2>Communication without<br />barriers.</h2>
            <p>SignRelay is free and open source. No account required. Start recognizing supported signs from your camera in seconds.</p>
            <div>
              <button className="figma-primary" onClick={onStart}>Start translating</button>
              <a className="figma-secondary" href="/languages">Explore languages</a>
            </div>
            <small>Open source · No account required · Research preview</small>
          </div>
        </div>
      </section>
    </div>
  );
}
