"use client";

import { useEffect, useState } from "react";
import { Modal } from "./modal";
import { MEASUREMENT_ID, privacySignalEnabled, readConsent, saveConsent, startAnalytics } from "@/lib/analytics-consent";

type Consent = "accepted" | "rejected" | null;

/** Footer control and, only when optional analytics is configured, a notice
 * asking first. Without a measurement ID there is nothing optional to agree
 * to, so no banner appears; the footer control explains what is stored. */
export function PrivacyChoices() {
  const [consent, setConsent] = useState<Consent>(null);
  const [signal, setSignal] = useState(false);
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let mounted = true;
    queueMicrotask(() => {
      if (!mounted) return;
      setSignal(privacySignalEnabled());
      setConsent(readConsent());
      setReady(true);
      startAnalytics();
    });
    return () => { mounted = false; };
  }, []);

  function choose(choice: "accepted" | "rejected") {
    saveConsent(choice);
    setConsent(choice);
    setOpen(false);
  }

  const optional = !!MEASUREMENT_ID && !signal;
  const banner = ready && optional && consent === null && !open;

  return <>
    <button type="button" className="footer-link-button" onClick={() => setOpen(true)} aria-haspopup="dialog">Cookie choices</button>
    {banner && (
      <section className="consent-banner" role="region" aria-labelledby="consent-title">
        <div>
          <h2 id="consent-title">Optional analytics</h2>
          <p>May SignRelay count page visits with Google Analytics? It stays off unless you allow it. Signs, video and transcripts are never included. <a href="/privacy#analytics">Details</a></p>
        </div>
        <div className="consent-actions">
          <button type="button" className="button secondary" onClick={() => choose("rejected")}>Reject</button>
          <button type="button" className="button secondary" onClick={() => choose("accepted")}>Allow</button>
        </div>
      </section>
    )}
    <Modal open={open} onClose={() => setOpen(false)} labelledBy="privacy-choices-title" describedBy="privacy-choices-summary" className="privacy-modal">
      <div className="modal-body" id="privacy-choices">
        <h2 id="privacy-choices-title">Cookie choices</h2>
        {!MEASUREMENT_ID ? (
          <p id="privacy-choices-summary">This version of SignRelay uses no analytics, advertising or tracking cookies, so there is nothing to opt in to.</p>
        ) : signal ? (
          <p id="privacy-choices-summary">Your browser sends a privacy signal (Global Privacy Control or Do Not Track). SignRelay respects it: optional analytics is off and cannot be turned on here.</p>
        ) : (
          <p id="privacy-choices-summary">Optional Google Analytics counts page visits. It is <strong>{consent === "accepted" ? "on" : "off"}</strong>{consent === null ? " until you choose" : ""}. Signs, video and transcripts are never sent to analytics.</p>
        )}
        <p className="modal-note">SignRelay always keeps a few things in this browser so it works: your settings, saved transcripts, personal signs, whether you have seen the tour{MEASUREMENT_ID ? " and this choice" : ""}. They never leave your device. <a href="/privacy#storage">What is stored</a></p>
        <div className="modal-actions">
          {optional && <>
            <button type="button" className="button secondary" onClick={() => choose("rejected")}>{consent === "accepted" ? "Turn off analytics" : "Keep analytics off"}</button>
            <button type="button" className="button secondary" onClick={() => choose("accepted")}>{consent === "accepted" ? "Keep analytics on" : "Allow analytics"}</button>
          </>}
          <button type="button" className="button ghost" onClick={() => setOpen(false)}>Close</button>
        </div>
      </div>
    </Modal>
  </>;
}
