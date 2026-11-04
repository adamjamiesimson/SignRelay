"use client";

// Supervised signer study (docs/evaluation/signer-study/PROTOCOL.md). Private
// route: omitted from public exports (scripts/exclude-private-routes.mjs).
// The study log lives in this tab's memory only. It holds SignRelay's outputs,
// the participant's decisions and selected corrections: no video, landmarks,
// names or absolute times. It is downloaded only with sharing consent.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TranslatorExperience } from "@/components/translator-experience";
import {
  CONSENT_VERSION, NO_CONSENT, REPORTABLE_GLOSSES, REPORT_OUTCOMES, STUDY_EXPORT_SCHEMA, STUDY_PLAN, assignSplit, buildSession, canExport, canRecord,
  classifyTrial, isPseudonym, observe, sessionConditions, validateStudySession, type ReportOutcome, type StudyConsent, type StudyEvent,
  type StudyObservation, type StudySessionExport, type StudySplit, type StudyTrial,
} from "@/lib/signer-study";
import styles from "./page.module.css";

const OUTCOME_LABELS: Record<ReportOutcome, string> = {
  "correct": "SignRelay showed what I signed",
  "wrong-word": "It showed a different word",
  "missed": "It showed nothing for my sign",
  "unexpected-word": "It showed a word when I was not signing it",
  "tracking-problem": "Camera or hand-tracking problem",
  "nothing-expected-nothing-shown": "Nothing was expected and nothing was shown",
};
const OBSERVATION_LABELS: Record<StudyObservation["kind"], string> = {
  offered: "suggested", repeated: "suggested again", waiting: "waiting", accepted: "added by you", dismissed: "dismissed",
  expired: "timed out", replaced: "replaced (not added)", automatic: "added automatically", removed: "removed by you",
};

type Setup = { pseudonym: string; session: number; enrolment: number; dominantHand: "" | "left" | "right"; deviceClass: string; camera: string; lighting: string };

export default function StudyPage() {
  const [consent, setConsent] = useState<StudyConsent>(NO_CONSENT);
  const [setup, setSetup] = useState<Setup>({ pseudonym: "", session: 1, enrolment: 0, dominantHand: "", deviceClass: "", camera: "", lighting: "" });
  // The split computed for a pseudonym; stale for any other pseudonym.
  const [assigned, setAssigned] = useState<{ pseudonym: string; split: StudySplit } | null>(null);
  const [phase, setPhase] = useState<"setup" | "running" | "finished">("setup");
  const [taskIndex, setTaskIndex] = useState(0);
  const [trials, setTrials] = useState<StudyTrial[]>([]);
  const [windowState, setWindowState] = useState<"idle" | "open" | "reporting">("idle");
  const [observations, setObservations] = useState<StudyObservation[]>([]);
  const [outcome, setOutcome] = useState<ReportOutcome | "">("");
  const [signed, setSigned] = useState("");
  const [notice, setNotice] = useState("");
  const [build, setBuild] = useState<StudySessionExport["build"]>({ profile: null, starter_output: null, recognition_worker_sha256: null });
  const sessionStart = useRef(0);
  const trialStart = useRef(0);
  const trialEnd = useRef(0);
  const windowRef = useRef<"idle" | "open" | "reporting">("idle");
  const headingRef = useRef<HTMLHeadingElement>(null);

  const tasks = useMemo(() => isPseudonym(setup.pseudonym) ? buildSession(setup.pseudonym, setup.session) : [], [setup.pseudonym, setup.session]);
  const task = tasks[taskIndex];
  const recommended = sessionConditions(setup.enrolment, setup.session);

  const split = assigned?.pseudonym === setup.pseudonym ? assigned.split : null;
  useEffect(() => {
    let cancelled = false;
    const pseudonym = setup.pseudonym;
    if (isPseudonym(pseudonym)) assignSplit(pseudonym).then(value => { if (!cancelled) setAssigned({ pseudonym, split: value }); }, () => {});
    return () => { cancelled = true; };
  }, [setup.pseudonym]);
  useEffect(() => {
    fetch("/runtime-manifest.json").then(r => r.ok ? r.json() : null).then(m => m && setBuild({ profile: m.profile ?? null,
      starter_output: m.starter_output ?? null, recognition_worker_sha256: m.recognition_worker_sha256 ?? null })).catch(() => {});
  }, []);

  // Workspace events are recorded only while a consented session has a task window open.
  const onStudyEvent = useCallback((event: StudyEvent) => {
    if (windowRef.current === "idle") return;
    setObservations(current => [...current, observe(event, sessionStart.current, performance.now())]);
  }, []);

  const ready = canRecord(consent) && isPseudonym(setup.pseudonym) && split !== null && setup.dominantHand !== "" && setup.deviceClass !== ""
    && setup.camera !== "" && setup.lighting !== "";
  const setWindow = (next: "idle" | "open" | "reporting") => { windowRef.current = next; setWindowState(next); };

  const startSession = () => {
    if (!ready) return;
    sessionStart.current = performance.now();
    setTrials([]); setTaskIndex(0); setPhase("running"); setWindow("idle");
    setNotice("Session started. Start the camera in the translator below, choose American Sign Language, then press Start task.");
    window.setTimeout(() => headingRef.current?.focus(), 0);
  };
  const startTask = () => {
    setObservations([]); setOutcome(""); setSigned("");
    trialStart.current = performance.now() - sessionStart.current;
    setWindow("open");
    setNotice(`Task ${taskIndex + 1} started. Sign when ready, then press Done.`);
  };
  const doneTask = () => {
    trialEnd.current = performance.now() - sessionStart.current;
    setWindow("reporting");
    setNotice("Choose what happened. You can still add or dismiss a suggestion before saving.");
  };
  const saveTask = () => {
    if (!task || !outcome) return;
    const trial: StudyTrial = { task_id: task.id, kind: task.kind, expected: task.expected, started_t: Math.round(trialStart.current),
      ended_t: Math.round(Math.max(trialStart.current, trialEnd.current)), observations, report: { outcome, signed: signed || null } };
    setTrials(current => [...current, trial]);
    setWindow("idle");
    if (taskIndex + 1 >= tasks.length) { setPhase("finished"); setNotice("All tasks recorded. Download the log if the participant agreed to share it, or delete it."); }
    else { setTaskIndex(taskIndex + 1); setNotice(`Saved. Task ${taskIndex + 2} of ${tasks.length} is ready.`); }
    window.setTimeout(() => headingRef.current?.focus(), 0);
  };
  const skipTask = () => {
    setWindow("idle");
    if (taskIndex + 1 >= tasks.length) setPhase("finished"); else setTaskIndex(taskIndex + 1);
    setNotice("Task skipped. Nothing was recorded for it.");
  };
  const exportLog = (): StudySessionExport => ({
    schema: STUDY_EXPORT_SCHEMA, plan_id: STUDY_PLAN.plan_id, participant: setup.pseudonym, session: setup.session, split: split!,
    conditions: { dominant_hand: setup.dominantHand as "left" | "right", camera_position: setup.camera, lighting: setup.lighting,
      device_class: setup.deviceClass, camera_resolution: null },
    consent: { version: CONSENT_VERSION, participate: true, keepLog: true, share: true, consent_ref: consent.consentRef },
    build, trials,
  });
  const download = () => {
    if (!canExport(consent) || !split) return;
    const data = exportLog();
    const errors = validateStudySession(data);
    if (errors.length) { setNotice(`Not downloaded: ${errors[0]}`); return; }
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = `${setup.pseudonym}-session${setup.session}.study.json`;
    document.body.appendChild(anchor); anchor.click(); anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    setNotice("Study log downloaded. Keep it private (evaluation/raw/signer-study/), then validate it with node scripts/signer-study.mjs validate.");
  };
  const discard = () => {
    setTrials([]); setObservations([]); setWindow("idle"); setPhase("setup"); setTaskIndex(0); setConsent(NO_CONSENT);
    setNotice("Session ended. The study log was deleted from this tab.");
  };

  const recorded = trials.map(classifyTrial);
  const field = (key: keyof Setup) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setSetup(current => ({ ...current, [key]: key === "session" || key === "enrolment" ? Number(event.target.value) : event.target.value }));

  return (
    <>
      <section className={styles.study} aria-labelledby="study-title" data-study-phase={phase}>
        <div className={styles.inner}>
          <p className={styles.kicker}>Private study tool · not part of the public app</p>
          <h1 id="study-title" ref={headingRef} tabIndex={-1}>
            {phase === "running" && task ? `Task ${taskIndex + 1} of ${tasks.length}` : phase === "finished" ? "Session complete" : "Signer study session"}
          </h1>
          {phase === "setup" && (
            <form className={styles.setup} onSubmit={event => { event.preventDefault(); startSession(); }}>
              <fieldset>
                <legend>Consent (read with the participant; every box starts unticked)</legend>
                <label className={styles.check}><input type="checkbox" checked={consent.participate} onChange={e => setConsent({ ...consent, participate: e.target.checked })} />
                  I am 18 or over and agree to take part in a supervised session using SignRelay&apos;s live translator.</label>
                <label className={styles.check}><input type="checkbox" checked={consent.keepLog} onChange={e => setConsent({ ...consent, keepLog: e.target.checked })} />
                  I agree that a local study log is kept: SignRelay&apos;s outputs, my decisions and my corrections. No video, images, landmarks or my name.</label>
                <label className={styles.check}><input type="checkbox" checked={consent.share} onChange={e => setConsent({ ...consent, share: e.target.checked })} />
                  Optional: the facilitator may download the log and share it privately with the SignRelay team for evaluation.</label>
                <label>Consent record reference (not a name)
                  <input value={consent.consentRef} onChange={e => setConsent({ ...consent, consentRef: e.target.value.trim().toLowerCase() })} placeholder="c-0007" autoComplete="off" spellCheck={false} /></label>
              </fieldset>
              <fieldset>
                <legend>Session</legend>
                <label>Study pseudonym<input value={setup.pseudonym} onChange={field("pseudonym")} placeholder="ss-2026-11-p01" autoComplete="off" spellCheck={false}
                  aria-invalid={setup.pseudonym !== "" && !isPseudonym(setup.pseudonym)} /></label>
                <p className={styles.note} data-study-split={split ?? ""}>{split ? `Split fixed at enrolment: ${split === "development" ? "development" : "held-out (sealed)"}.` : "Enter a pseudonym such as ss-2026-11-p01. Never a name."}</p>
                <label>Session<select value={setup.session} onChange={field("session")}><option value={1}>1</option><option value={2}>2</option></select></label>
                <label>Enrolment number (order this signer joined, from 0)<input type="number" min={0} max={99} value={setup.enrolment} onChange={field("enrolment")} /></label>
                <label>Dominant signing hand<select value={setup.dominantHand} onChange={field("dominantHand")}><option value="">Choose</option><option value="left">Left</option><option value="right">Right</option></select></label>
                <label>Device<select value={setup.deviceClass} onChange={field("deviceClass")}><option value="">Choose</option>{STUDY_PLAN.conditions.device_classes.map(d => <option key={d} value={d}>{d}</option>)}</select></label>
                <label>Camera position (plan: {recommended.camera_position})<select value={setup.camera} onChange={field("camera")}><option value="">Choose</option>
                  {STUDY_PLAN.conditions.camera_position.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
                <label>Lighting (plan: {recommended.lighting})<select value={setup.lighting} onChange={field("lighting")}><option value="">Choose</option>
                  {STUDY_PLAN.conditions.lighting.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
              </fieldset>
              <div className={styles.actions}>
                <button type="submit" className="button primary" disabled={!ready}>Start session</button>
              </div>
              <p className={styles.note}>Nothing is recorded until both required boxes are ticked and a consent reference is entered. Nothing is ever uploaded.</p>
            </form>
          )}
          {phase === "running" && task && (
            <div className={styles.runner}>
              <p className={styles.instruction} data-study-task={task.id}>{task.instruction}</p>
              <div className={styles.actions}>
                <button type="button" className="button primary" onClick={startTask} disabled={windowState !== "idle"}>Start task</button>
                <button type="button" className="button secondary" onClick={doneTask} disabled={windowState !== "open"}>Done</button>
                <button type="button" className="button ghost" onClick={skipTask} disabled={windowState === "reporting"}>Skip task</button>
              </div>
              {windowState !== "idle" && (
                <div className={styles.seen}>
                  <h2>What SignRelay did during this task</h2>
                  {observations.length ? <ul data-study-observations>{observations.map((o, i) => <li key={i}>{o.source === "personal" ? "Your sign" : o.gloss} · {OBSERVATION_LABELS[o.kind]}</li>)}</ul>
                    : <p>Nothing yet.</p>}
                </div>
              )}
              {windowState === "reporting" && (
                <fieldset className={styles.report}>
                  <legend>What happened?</legend>
                  {REPORT_OUTCOMES.map(value => (
                    <label key={value} className={styles.check}><input type="radio" name="study-outcome" value={value} checked={outcome === value} onChange={() => setOutcome(value)} />{OUTCOME_LABELS[value]}</label>
                  ))}
                  <label>What did you sign? (optional)<select value={signed} onChange={e => setSigned(e.target.value)}><option value="">Not listed / prefer not to say</option>
                    {REPORTABLE_GLOSSES.map(g => <option key={g} value={g}>{g}</option>)}</select></label>
                  <div className={styles.actions}><button type="button" className="button primary" onClick={saveTask} disabled={!outcome}>Save and next</button></div>
                </fieldset>
              )}
            </div>
          )}
          {phase !== "setup" && (
            <div className={styles.actions}>
              {phase === "finished" && <button type="button" className="button primary" onClick={download} disabled={!canExport(consent)}>Download study log</button>}
              <button type="button" className="button ghost" onClick={discard}>End session and delete log</button>
            </div>
          )}
          {phase !== "setup" && <p className={styles.note} data-study-progress>{trials.length} of {tasks.length} tasks recorded · first output matched the expected sign in {recorded.filter(r => r.raw === "correct").length} ·
            words you added that were wrong: {recorded.reduce((n, r) => n + r.transcript.wrongAccepted, 0)}{canExport(consent) ? "" : " · sharing not agreed: the log cannot be downloaded"}</p>}
          <p className="sr-only" role="status" aria-live="polite">{notice}</p>
          {notice && <p className={styles.note} aria-hidden="true">{notice}</p>}
        </div>
      </section>
      <TranslatorExperience onStudyEvent={phase === "running" ? onStudyEvent : undefined} />
    </>
  );
}
