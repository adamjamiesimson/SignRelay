"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { BookPlus, Camera, Languages, MessageSquareText, type LucideIcon } from "lucide-react";
import type { OnboardingStatus } from "@/lib/browser-storage";

type Step = { target: string; title: string; body: string; icon: LucideIcon };

/** Four short steps over the real workspace. Nothing here starts the camera. */
export const TOUR_STEPS: Step[] = [
  { target: "language", icon: Languages, title: "Choose your language",
    body: "Switch sign language here at any time. Seven have experimental automatic recognition; the others recognise only signs you teach." },
  { target: "camera", icon: Camera, title: "Start signing",
    body: "Turn the camera on when you are ready; your browser asks for permission first. Video is analysed on this device and never uploaded." },
  { target: "transcript", icon: MessageSquareText, title: "Your words, your way",
    body: "Only confirmed words appear here. Edit or remove any word, copy the text, or have it spoken aloud by your device." },
  { target: "teach", icon: BookPlus, title: "Teach SignRelay",
    body: "Record your own signs to add words. They are saved only in this browser, and Privacy & data clears everything, including this tour." },
];

type Rect = { top: number; left: number; width: number; height: number };

export function OnboardingTour({ open, onClose }: { open: boolean; onClose: (status: OnboardingStatus) => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const step = TOUR_STEPS[index];
  const last = index === TOUR_STEPS.length - 1;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal(); else dialog.setAttribute("open", "");
    } else if (!open && dialog.open) dialog.close();
  }, [open]);

  const measure = useCallback(() => {
    const target = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
    const box = target?.getBoundingClientRect();
    setRect(box && box.width ? { top: box.top, left: box.left, width: box.width, height: box.height } : null);
  }, [step.target]);

  // Bring the highlighted control into view, then follow it while the page
  // scrolls or resizes. The heading takes focus so each step is announced.
  useLayoutEffect(() => {
    if (!open) return;
    const target = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target?.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
    headingRef.current?.focus();
    let frame = 0;
    const update = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    const settle = window.setTimeout(update, reduce ? 0 : 450);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(settle);
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open, step.target, measure]);

  const go = (next: number) => setIndex(Math.max(0, Math.min(TOUR_STEPS.length - 1, next)));
  // Start from the first step next time the tour opens.
  const close = (status: OnboardingStatus) => { setIndex(0); setRect(null); onClose(status); };
  const Icon = step.icon;
  const pad = 8;
  const spotlight = rect && { top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 };

  return (
    <dialog ref={dialogRef} className="tour" aria-labelledby="tour-title" aria-describedby="tour-body"
      onCancel={event => { event.preventDefault(); close("dismissed"); }}
      onKeyDown={event => {
        if (event.key === "ArrowRight" && !last) { event.preventDefault(); go(index + 1); }
        if (event.key === "ArrowLeft" && index) { event.preventDefault(); go(index - 1); }
      }}>
      {open && <>
        <div className={`tour-spotlight${spotlight ? "" : " none"}`} aria-hidden="true" style={spotlight ?? undefined} />
        <div className={`tour-card ${spotlight && spotlight.top + spotlight.height / 2 > window.innerHeight / 2 ? "above" : "below"}`}
          style={spotlight ? tourCardPosition(spotlight) : undefined}>
          <div className="tour-card-head">
            <span className="tour-icon" aria-hidden="true"><Icon size={20} /></span>
            <span className="tour-count">Step {index + 1} of {TOUR_STEPS.length}</span>
          </div>
          <h2 id="tour-title" ref={headingRef} tabIndex={-1}>{step.title}</h2>
          <p id="tour-body">{step.body}</p>
          <div className="tour-progress" aria-hidden="true">
            {TOUR_STEPS.map((item, i) => <i key={item.target} className={i === index ? "current" : i < index ? "done" : ""} />)}
          </div>
          <div className="tour-actions">
            {!last && <button type="button" className="button ghost small" onClick={() => close("dismissed")}>Skip tour</button>}
            <span className="tour-actions-end">
              {index > 0 && <button type="button" className="button secondary small" onClick={() => go(index - 1)}>Back</button>}
              {last
                ? <button type="button" className="button primary small" onClick={() => close("completed")}>Finish</button>
                : <button type="button" className="button primary small" onClick={() => go(index + 1)}>Next</button>}
            </span>
          </div>
        </div>
      </>}
    </dialog>
  );
}

/** Beside the highlight on wide screens; phones use a bottom sheet (CSS). */
function tourCardPosition(spot: Rect): React.CSSProperties {
  const width = 360, gap = 14, margin = 16;
  const left = Math.max(margin, Math.min(spot.left, window.innerWidth - width - margin));
  const below = spot.top + spot.height / 2 <= window.innerHeight / 2;
  const top = below ? Math.min(spot.top + spot.height + gap, window.innerHeight - 260) : undefined;
  const bottom = below ? undefined : Math.min(window.innerHeight - spot.top + gap, window.innerHeight - 260);
  return { "--tour-left": `${left}px`, "--tour-top": top === undefined ? "auto" : `${Math.max(margin, top)}px`,
    "--tour-bottom": bottom === undefined ? "auto" : `${Math.max(margin, bottom)}px` } as React.CSSProperties;
}
