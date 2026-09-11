"use client";
import { useEffect, useState } from "react";
import { MEASUREMENT_ID, privacySignalEnabled, readConsent, saveConsent, startAnalytics } from "@/lib/analytics-consent";

export function PrivacyChoices() {
  const [open, setOpen] = useState(false);
  const [signal, setSignal] = useState(false);
  useEffect(() => {
    let mounted = true;
    queueMicrotask(() => {
      if (!mounted) return;
      setSignal(privacySignalEnabled());
      setOpen(readConsent() === null);
      startAnalytics();
    });
    return () => { mounted = false; };
  }, []);
  function choose(choice: "accepted" | "rejected") { saveConsent(choice); setOpen(false); }
  return <>
    <button className="privacy-settings-link" onClick={() => setOpen(current => !current)} aria-expanded={open} aria-controls="privacy-choices">Cookie choices</button>
    {open && <section className="cookie-banner" id="privacy-choices" aria-label="Cookie and local storage choices">
      <div><h2>Your privacy, your choice.</h2>
        <p>{MEASUREMENT_ID ? "Optional Google Analytics helps us understand page visits. It stays off until you agree. Your signs and transcripts are never sent to analytics." : "We use local storage for your settings, saved transcripts and privacy choice. No analytics cookies are used."} <a href="/privacy">Privacy policy</a></p>
        {signal && <p>We respect your browser’s privacy signal. Analytics is disabled.</p>}
      </div>
      <div className="cookie-actions">
        <button className="button secondary small" onClick={() => choose("rejected")}>{MEASUREMENT_ID ? "Reject optional" : "Got it"}</button>
        {MEASUREMENT_ID && !signal && <button className="button secondary small" onClick={() => choose("accepted")}>Allow analytics</button>}
      </div>
    </section>}
  </>;
}
