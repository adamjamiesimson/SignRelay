// Supervised signer study (docs/evaluation/signer-study/). Browser-safe and
// pure: session generation, signer-disjoint split assignment, consent gating,
// the PII-free session export and its validator, and summaries that keep raw
// recognition separate from transcript safety.
//
// The study tool records NO video, image, landmark, audio, name, device label
// or absolute time: only task ids, SignRelay's outputs and the participant's
// own decisions and selected corrections, with times relative to the session.
import plan from "../docs/evaluation/signer-study/plan-2026-11.json";

export const STUDY_PLAN = plan;
export const STUDY_EXPORT_SCHEMA = "signrelay-study-session/1";
export const CONSENT_VERSION = "signer-study-consent-2026-11-v1";

export type StudySplit = "development" | "held_out";
export type StudyTaskKind = "starter" | "confusable" | "everyday" | "unsupported" | "sequence";
export type StudyTask = {
  id: string;
  kind: StudyTaskKind;
  /** What the participant is asked to do. */
  instruction: string;
  /** Expected glosses in order; null when no sign is expected (everyday) or
   * the sign is outside SignRelay's vocabulary (unsupported). */
  expected: string[] | null;
};

/** Every gloss a participant may report having signed. */
export const REPORTABLE_GLOSSES: readonly string[] = [...plan.tasks.starter_signs.glosses, ...plan.tasks.confusable_signs.glosses];

// ---- Deterministic, reproducible ordering (no Math.random) -------------------
function fnv1a(text: string) {
  let hash = 0x811c9dc5;
  for (const char of text) { hash ^= char.codePointAt(0)!; hash = Math.imul(hash, 0x01000193) >>> 0; }
  return hash >>> 0;
}
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffled<T>(items: readonly T[], seed: string): T[] {
  const random = mulberry32(fnv1a(seed)), out = [...items];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

export const isPseudonym = (id: string) => new RegExp(plan.participants.pseudonym_pattern).test(id);

/** Tasks for one session, blocks in the plan's fixed order, shuffled inside each
 * block by a seed from the pseudonym and session number. */
export function buildSession(pseudonym: string, session: number): StudyTask[] {
  if (!isPseudonym(pseudonym)) throw new Error("Use a study pseudonym (ss-2026-11-pNN), never a name");
  if (!Number.isInteger(session) || session < 1 || session > plan.conditions.sessions_per_signer) throw new Error("Invalid session number");
  const seed = (block: string) => `${plan.plan_id}:${pseudonym}:${session}:${block}`;
  const { starter_signs: starter, confusable_signs: confusable, everyday_movements: everyday, unsupported_signs: unsupported, sequences } = plan.tasks;
  const starterTasks: StudyTask[] = starter.glosses.flatMap(gloss => starter.take_instructions.map((how, take) => ({
    id: `starter:${gloss}:${take + 1}`, kind: "starter" as const, instruction: `Sign ${gloss} ${how}.`, expected: [gloss] })));
  const everydayTasks: StudyTask[] = everyday.items.map(item => ({ id: `everyday:${item.id}`, kind: "everyday" as const, instruction: `${item.instruction}. Do not sign.`, expected: null }));
  const confusableTasks: StudyTask[] = confusable.glosses.map(gloss => ({ id: `confusable:${gloss}`, kind: "confusable" as const, instruction: `Sign ${gloss}.`, expected: [gloss] }));
  const unsupportedTasks: StudyTask[] = Array.from({ length: unsupported.slots }, (_, i) => ({ id: `unsupported:${i + 1}`, kind: "unsupported" as const,
    instruction: `Sign the facilitator's chosen sign number ${i + 1}.`, expected: null }));
  const sequenceTasks: StudyTask[] = sequences.items.map(item => ({ id: `sequence:${item.id}`, kind: "sequence" as const,
    instruction: `Sign ${item.glosses.join(", then ")} one after another without pausing.`, expected: item.glosses }));
  return [
    ...shuffled(starterTasks, seed("starter")), ...shuffled(everydayTasks, seed("everyday")), ...shuffled(confusableTasks, seed("confusable")),
    ...shuffled(unsupportedTasks, seed("unsupported")), ...shuffled(sequenceTasks, seed("sequence")),
  ];
}

/** Capture conditions for a session, by enrolment order (0-based). */
export function sessionConditions(enrolmentIndex: number, session: number): { camera_position: string; lighting: string } {
  if (session === 1) return { camera_position: "front-eye-level", lighting: "even-bright" };
  const pairs = plan.conditions.session_conditions[1].pairs as string[][];
  const [camera_position, lighting] = pairs[((enrolmentIndex % pairs.length) + pairs.length) % pairs.length];
  return { camera_position, lighting };
}

/** Signer-disjoint split, fixed at enrolment from the pseudonym and plan salt. */
export async function assignSplit(pseudonym: string, digest: (text: string) => Promise<Uint8Array> = webDigest): Promise<StudySplit> {
  if (!isPseudonym(pseudonym)) throw new Error("Use a study pseudonym");
  const bytes = await digest(`${plan.split.salt}:${pseudonym}`);
  return bytes[0] % 2 === 0 ? "development" : "held_out";
}
async function webDigest(text: string) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

// ---- Consent ---------------------------------------------------------------
export type StudyConsent = {
  version: typeof CONSENT_VERSION;
  /** Required: taking part in a supervised session with the live translator. */
  participate: boolean;
  /** Required to record anything: keep a local study log of SignRelay's outputs
   * and my decisions and corrections (no video, landmarks or names). */
  keepLog: boolean;
  /** Optional: allow the facilitator to download the log and share it with the
   * SignRelay team privately for evaluation. */
  share: boolean;
  /** Reference to the private consent record (not a name or contact detail). */
  consentRef: string;
};
export const NO_CONSENT: StudyConsent = { version: CONSENT_VERSION, participate: false, keepLog: false, share: false, consentRef: "" };
export const CONSENT_REF_PATTERN = /^[a-z0-9][a-z0-9-]{3,39}$/;
export const canRecord = (consent: StudyConsent) => consent.participate && consent.keepLog && CONSENT_REF_PATTERN.test(consent.consentRef);
export const canExport = (consent: StudyConsent) => canRecord(consent) && consent.share;

// ---- Observations and trials ------------------------------------------------
export type StudyObservationKind = "offered" | "repeated" | "waiting" | "accepted" | "dismissed" | "expired" | "replaced" | "automatic" | "removed";
export type StudySource = "starter" | "model" | "personal";
/** What the workspace reports to an observing study page (never in a public build). */
export type StudyEvent = { kind: StudyObservationKind; gloss: string; source: StudySource };
export type StudyObservation = StudyEvent & { t: number };
export const REPORT_OUTCOMES = ["correct", "wrong-word", "missed", "unexpected-word", "tracking-problem", "nothing-expected-nothing-shown"] as const;
export type ReportOutcome = (typeof REPORT_OUTCOMES)[number];
export type StudyTrial = {
  task_id: string;
  kind: StudyTaskKind;
  expected: string[] | null;
  /** Milliseconds since the session started. */
  started_t: number;
  ended_t: number;
  observations: StudyObservation[];
  report: { outcome: ReportOutcome; signed: string | null };
};
export type StudySessionExport = {
  schema: typeof STUDY_EXPORT_SCHEMA;
  plan_id: string;
  participant: string;
  session: number;
  split: StudySplit;
  conditions: { dominant_hand: "left" | "right"; camera_position: string; lighting: string; device_class: string; camera_resolution: string | null };
  consent: { version: string; participate: true; keepLog: true; share: true; consent_ref: string };
  build: { profile: string | null; starter_output: string | null; recognition_worker_sha256: string | null };
  trials: StudyTrial[];
};

const OUTPUT_KINDS = new Set<StudyObservationKind>(["offered", "automatic"]);
const normal = (gloss: string) => gloss.normalize("NFC").trim().toUpperCase();

/** One trial, scored two separate ways: raw recognition (what SignRelay
 * produced at all) and transcript safety (what actually entered the transcript). */
export function classifyTrial(trial: StudyTrial) {
  const outputs = trial.observations.filter(o => OUTPUT_KINDS.has(o.kind));
  const expected = (trial.expected ?? []).map(normal);
  const first = outputs[0];
  const firstGloss = first ? normal(first.gloss) : null;
  let raw: "correct" | "wrong" | "none" | "false-output" | "abstained";
  if (!expected.length) raw = first ? "false-output" : "abstained";
  else raw = !first ? "none" : expected.includes(firstGloss!) ? "correct" : "wrong";
  const entered = trial.observations.filter(o => o.kind === "automatic" || o.kind === "accepted").map(o => ({ gloss: normal(o.gloss), how: o.kind, source: o.source }));
  const removed = trial.observations.filter(o => o.kind === "removed").map(o => normal(o.gloss));
  const isRight = (gloss: string) => expected.includes(gloss);
  return {
    raw,
    firstOutputMs: first ? Math.max(0, first.t - trial.started_t) : null,
    outputs: outputs.length,
    transcript: {
      correctEntered: entered.filter(e => isRight(e.gloss)).length,
      wrongEntered: entered.filter(e => !isRight(e.gloss)).length,
      wrongAutomatic: entered.filter(e => !isRight(e.gloss) && e.how === "automatic").length,
      /** The habitual-acceptance measure: wrong words the participant added. */
      wrongAccepted: entered.filter(e => !isRight(e.gloss) && e.how === "accepted").length,
      wrongRemovedAfterwards: removed.filter(g => !isRight(g)).length,
    },
    decisions: {
      dismissedWrong: trial.observations.filter(o => o.kind === "dismissed" && !isRight(normal(o.gloss))).length,
      dismissedCorrect: trial.observations.filter(o => o.kind === "dismissed" && isRight(normal(o.gloss))).length,
      lostCorrect: trial.observations.filter(o => (o.kind === "expired" || o.kind === "replaced") && isRight(normal(o.gloss))).length,
    },
    report: trial.report,
  };
}

type Tally = { trials: number; correct: number; wrong: number; none: number; falseOutput: number; abstained: number;
  correctEntered: number; wrongEntered: number; wrongAutomatic: number; wrongAccepted: number; dismissedWrong: number; lostCorrect: number; latencies: number[];
  signerSet: Set<string> };
const emptyTally = (): Tally => ({ trials: 0, correct: 0, wrong: 0, none: 0, falseOutput: 0, abstained: 0, correctEntered: 0, wrongEntered: 0,
  wrongAutomatic: 0, wrongAccepted: 0, dismissedWrong: 0, lostCorrect: 0, latencies: [], signerSet: new Set() });

/** Counts by split and task kind, and by expected gloss. Refuses held-out
 * sessions unless the caller declares a frozen, once-only final measurement. */
export function summariseSessions(sessions: StudySessionExport[], { includeHeldOut = false } = {}) {
  if (!includeHeldOut && sessions.some(s => s.split === "held_out")) throw new Error("Held-out sessions are sealed: summarise development sessions only, or pass includeHeldOut for a frozen candidate's final measurement");
  const bySplitKind: Record<string, Tally> = {}, byGloss: Record<string, Tally> = {};
  const signers = new Map<string, StudySplit>();
  for (const session of sessions) {
    signers.set(session.participant, session.split);
    for (const trial of session.trials) {
      const result = classifyTrial(trial);
      const keys = [[bySplitKind, `${session.split}/${trial.kind}`], ...(trial.expected?.length === 1 ? [[byGloss, `${session.split}/${trial.expected[0]}`]] : [])] as [Record<string, Tally>, string][];
      for (const [table, key] of keys) {
        const t = (table[key] ??= emptyTally());
        t.trials++;
        t.signerSet.add(session.participant);
        if (result.raw === "correct") t.correct++; else if (result.raw === "wrong") t.wrong++; else if (result.raw === "none") t.none++;
        else if (result.raw === "false-output") t.falseOutput++; else t.abstained++;
        t.correctEntered += result.transcript.correctEntered; t.wrongEntered += result.transcript.wrongEntered;
        t.wrongAutomatic += result.transcript.wrongAutomatic; t.wrongAccepted += result.transcript.wrongAccepted;
        t.dismissedWrong += result.decisions.dismissedWrong; t.lostCorrect += result.decisions.lostCorrect;
        if (result.raw === "correct" && result.firstOutputMs !== null) t.latencies.push(result.firstOutputMs);
      }
    }
  }
  const finish = ({ latencies, signerSet, ...t }: Tally) => ({ ...t, signers: signerSet.size, medianFirstCorrectMs: median(latencies) });
  return {
    signers: { development: [...signers.values()].filter(s => s === "development").length, held_out: [...signers.values()].filter(s => s === "held_out").length },
    sessions: sessions.length,
    bySplitKind: Object.fromEntries(Object.entries(bySplitKind).map(([k, t]) => [k, finish(t)])),
    byGloss: Object.fromEntries(Object.entries(byGloss).map(([k, t]) => [k, finish(t)])),
  };
}
/** For public reporting: cells from fewer than `minimum` signers are withheld. */
export function suppressSmallCells<T extends { signers: number }>(table: Record<string, T>, minimum = 3): Record<string, T | "fewer than 3 signers"> {
  return Object.fromEntries(Object.entries(table).map(([key, cell]) => [key, cell.signers >= minimum ? cell : "fewer than 3 signers"]));
}
const median = (values: number[]) => values.length ? [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) / 2)] : null;

// ---- Export validation (strict: unknown keys are refused, so nothing extra leaks) ----
const KEYS = {
  root: ["schema", "plan_id", "participant", "session", "split", "conditions", "consent", "build", "trials"],
  conditions: ["dominant_hand", "camera_position", "lighting", "device_class", "camera_resolution"],
  consent: ["version", "participate", "keepLog", "share", "consent_ref"],
  build: ["profile", "starter_output", "recognition_worker_sha256"],
  trial: ["task_id", "kind", "expected", "started_t", "ended_t", "observations", "report"],
  observation: ["t", "kind", "gloss", "source"],
  report: ["outcome", "signed"],
};
const OBS_KINDS = new Set<string>(["offered", "repeated", "waiting", "accepted", "dismissed", "expired", "replaced", "automatic", "removed"]);
const SOURCES = new Set<string>(["starter", "model", "personal"]);

export function validateStudySession(value: unknown, { knownSplit }: { knownSplit?: StudySplit } = {}): string[] {
  const errors: string[] = [];
  const err = (message: string) => { errors.push(message); };
  const keysOk = (object: unknown, allowed: string[], where: string): object is Record<string, unknown> => {
    if (!object || typeof object !== "object" || Array.isArray(object)) { err(`${where}: not an object`); return false; }
    for (const key of Object.keys(object)) if (!allowed.includes(key)) err(`${where}: unexpected field "${key}" (refused: only the documented fields may be exported)`);
    return true;
  };
  if (!keysOk(value, KEYS.root, "session")) return errors;
  const s = value as Record<string, unknown>;
  if (s.schema !== STUDY_EXPORT_SCHEMA) err("schema: unsupported");
  if (s.plan_id !== plan.plan_id) err("plan_id: not this study plan");
  if (typeof s.participant !== "string" || !isPseudonym(s.participant)) err("participant: must be a study pseudonym");
  if (!Number.isInteger(s.session) || (s.session as number) < 1 || (s.session as number) > plan.conditions.sessions_per_signer) err("session: invalid");
  if (!plan.split.values.includes(s.split as string)) err("split: invalid");
  if (knownSplit && s.split !== knownSplit) err("split: differs from the split assigned at enrolment (signer leakage)");
  if (keysOk(s.conditions, KEYS.conditions, "conditions")) {
    const c = s.conditions as Record<string, unknown>;
    if (!["left", "right"].includes(c.dominant_hand as string)) err("conditions.dominant_hand: left or right");
    if (!plan.conditions.camera_position.some(p => p.id === c.camera_position)) err("conditions.camera_position: not in the plan");
    if (!plan.conditions.lighting.some(p => p.id === c.lighting)) err("conditions.lighting: not in the plan");
    if (!plan.conditions.device_classes.includes(c.device_class as string)) err("conditions.device_class: not in the plan");
    if (c.camera_resolution !== null && !/^\d{2,5}x\d{2,5}$/.test(String(c.camera_resolution))) err("conditions.camera_resolution: WIDTHxHEIGHT or null");
  }
  if (keysOk(s.consent, KEYS.consent, "consent")) {
    const c = s.consent as Record<string, unknown>;
    if (c.version !== CONSENT_VERSION) err("consent.version: not the current consent text");
    if (c.participate !== true || c.keepLog !== true || c.share !== true) err("consent: participation, logging and sharing must all have been given");
    if (typeof c.consent_ref !== "string" || !CONSENT_REF_PATTERN.test(c.consent_ref)) err("consent.consent_ref: a private record reference (lowercase letters, digits, hyphens)");
  }
  if (keysOk(s.build, KEYS.build, "build")) {
    const b = s.build as Record<string, unknown>;
    if (b.recognition_worker_sha256 !== null && !/^[a-f0-9]{64}$/.test(String(b.recognition_worker_sha256))) err("build.recognition_worker_sha256: invalid");
  }
  if (!Array.isArray(s.trials)) { err("trials: not a list"); return errors; }
  const tasks = new Map(typeof s.participant === "string" && isPseudonym(s.participant) && Number.isInteger(s.session) && (s.session as number) >= 1 && (s.session as number) <= plan.conditions.sessions_per_signer
    ? buildSession(s.participant, s.session as number).map(t => [t.id, t]) : []);
  const seen = new Set<string>();
  (s.trials as unknown[]).forEach((trial, index) => {
    const where = `trials[${index}]`;
    if (!keysOk(trial, KEYS.trial, where)) return;
    const t = trial as Record<string, unknown>;
    const task = tasks.get(t.task_id as string);
    if (!task) { err(`${where}.task_id: not a task of this participant's session`); return; }
    if (seen.has(task.id)) err(`${where}.task_id: repeated (one record per task)`);
    seen.add(task.id);
    if (t.kind !== task.kind || JSON.stringify(t.expected) !== JSON.stringify(task.expected)) err(`${where}: kind/expected do not match the plan`);
    if (typeof t.started_t !== "number" || typeof t.ended_t !== "number" || t.started_t < 0 || t.ended_t < t.started_t || t.ended_t > 6 * 3600_000)
      err(`${where}: times must be relative milliseconds (no absolute timestamps)`);
    if (!Array.isArray(t.observations)) err(`${where}.observations: not a list`);
    else (t.observations as unknown[]).forEach((o, j) => {
      if (!keysOk(o, KEYS.observation, `${where}.observations[${j}]`)) return;
      const obs = o as Record<string, unknown>;
      if (!OBS_KINDS.has(obs.kind as string) || !SOURCES.has(obs.source as string)) err(`${where}.observations[${j}]: invalid kind or source`);
      if (typeof obs.t !== "number" || obs.t < 0 || obs.t > 6 * 3600_000) err(`${where}.observations[${j}].t: relative milliseconds`);
      // Personal-sign glosses are user-defined and could be anything (a name):
      // they are exported only as the marker PERSONAL.
      if (obs.source === "personal" ? obs.gloss !== "PERSONAL" : typeof obs.gloss !== "string" || !/^[A-Z0-9 '-]{1,40}$/.test(obs.gloss))
        err(`${where}.observations[${j}].gloss: a vocabulary gloss (personal signs as PERSONAL)`);
    });
    if (keysOk(t.report, KEYS.report, `${where}.report`)) {
      const r = t.report as Record<string, unknown>;
      if (!(REPORT_OUTCOMES as readonly string[]).includes(r.outcome as string)) err(`${where}.report.outcome: invalid`);
      if (r.signed !== null && !REPORTABLE_GLOSSES.includes(r.signed as string)) err(`${where}.report.signed: choose from the plan's gloss list (no free text)`);
    }
  });
  return errors;
}

/** The observation a study page records for a workspace event. Personal-sign
 * glosses are user-chosen text, so only their kind is kept. */
export function observe(event: StudyEvent, sessionStart: number, now: number): StudyObservation {
  return { t: Math.max(0, Math.round(now - sessionStart)), kind: event.kind, gloss: event.source === "personal" ? "PERSONAL" : normal(event.gloss).slice(0, 40), source: event.source };
}
